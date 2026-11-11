import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordingLines, generateRecording, sampleIdentity } from './generate.mjs';
import { scenarios } from './scenarios.mjs';

function observations(lines) { return lines.reduce((sum,line)=>sum+(line.events?.length ?? 1),0); }
test('four deterministic scenarios contain coherent trees, four subsystems and correlated stress signals', () => {
  for (const domain of Object.keys(scenarios)) {
    const lines = [...recordingLines(domain, 25000)];
    assert.equal(observations(lines),25000);
    assert.deepEqual([...recordingLines(domain,100)], [...recordingLines(domain,100)]);
    const namespaces = new Set();
    for (const line of lines.filter(line=>line.type==='events')) {
      const byId = new Map(line.events.map(event=>[event.id,event]));
      assert.equal(byId.size,line.events.length);
      for (const event of line.events) {
        namespaces.add(event.namespace);
        if (event.parent) {
          const parent = byId.get(event.parent);assert.ok(parent);
          assert.ok(event.at >= parent.at - .002);
          assert.ok(event.at + (event.duration ?? 0) <= parent.at + parent.duration + .002);
        }
      }
    }
    assert.deepEqual([...namespaces],scenarios[domain].namespaces);
    assert.ok(lines.some(line=>line.type==='cpu-sample' && line.sample.duration>50));
    assert.ok(lines.some(line=>line.type==='extension-sample' && line.sample.data.cacheHit===false));
    const fps = lines.filter(line=>line.sample?.metric==='frame.fps').map(line=>line.sample.value);
    assert.ok(Math.min(...fps)<30 && Math.max(...fps)===60);
  }
});

test('streaming publication counts, reuses and protects existing recordings', async () => {
  const directory = await mkdtemp(join(tmpdir(),'sx-samples-'));
  try {
    const first = await generateRecording(directory,'editor',25000);
    assert.equal(first.eventCount+first.browserSampleCount+first.cpuSampleCount+first.extensionSampleCount,25000);
    const data = join(directory,`${first.sessionId}.jsonl`);
    const before = await stat(data);
    const second = await generateRecording(directory,'editor',25000);
    assert.equal(second.reused,true);
    assert.equal((await stat(data)).mtimeMs,before.mtimeMs);
    const meta = JSON.parse(await readFile(join(directory,`${first.sessionId}.meta.json`),'utf8'));
    assert.equal(meta.status,'complete');assert.ok(meta.title.includes('SYNTHETIC'));
    const { appendFile } = await import('node:fs/promises');
    await appendFile(data,'{}\n');
    await assert.rejects(generateRecording(directory,'editor',25000),/Refusing to overwrite/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('invalid sizes and unknown domains are rejected before generation', () => {
  for (const value of [NaN,0,1.5,2_000_001]) assert.throws(()=>sampleIdentity('editor',value));
  assert.throws(()=>sampleIdentity('unknown',1000));
});

test('saved samples load through the actual paged dashboard APIs', async () => {
  const { startRecordingServer } = await import('../../packages/dashboard/dist/server.js');
  const directory = await mkdtemp(join(tmpdir(),'sx-sample-api-'));
  let server;
  try {
    const meta = await generateRecording(directory,'editor',25000);
    server = await startRecordingServer({port:0,recordingsDirectory:directory});
    const base = `http://127.0.0.1:${server.address().port}/api/recordings`;
    const get = async route => { const response=await fetch(base+route);assert.equal(response.status,200);return response.json(); };
    const list = await get('');assert.ok(list.some(item=>item.sessionId===meta.sessionId));
    const summary = await get(`/${meta.sessionId}/summary`);
    assert.ok(summary.analysis.functions.length>0);
    assert.ok(summary.browser.series.some(series=>series.metric==='frame.fps'));
    const frames = await get(`/${meta.sessionId}/frames?namespace=layout`);
    assert.ok(frames.total>100);assert.ok(frames.items.length<=100);
    assert.ok(frames.items.every(event=>event.namespace==='layout'));
    const extension = await get(`/${meta.sessionId}/extensions?channel=editor.scene`);
    assert.ok(extension.total>0);
  } finally {
    if (server) await new Promise(done=>server.close(done));
    await rm(directory,{recursive:true,force:true});
  }
});
