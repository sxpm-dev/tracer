import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const require = createRequire(import.meta.url);
globalThis.location = { search: '?install-tracing' };
const tracing = await import('@sx/tracing');
const recordings = await import('@sx/recordings');
assert.equal(tracing.trace, recordings.trace);
assert.equal(require('@sx/tracing').trace, tracing.trace);
assert.equal(typeof require('@sx/dashboard/server').startRecordingServer, 'function');
const commonRecordings = require('@sx/recordings');
assert.equal(commonRecordings.getRecordingState, recordings.getRecordingState);
const { createRecordingClient, createSessionClient } = await import('@sx/dashboard/data');
const unregister = recordings.registerTraceCollector({
  name: 'consumer.cache',
  onStop: () => recordings.addTraceExtensionSample('consumer.cache', { hits: 7 }),
});
const child = spawn(process.execPath, ['node_modules/@sx/dashboard/dist/cli.js', '--port', '0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const closed = once(child, 'exit');
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`CLI startup timed out: ${stderr}`)), 10000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`CLI exited ${code}: ${stderr}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Trace dashboard: (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Trace dashboard/);
  const asset = html.match(/src="([^"]+\.js)"/);
  assert.ok(asset, 'Standalone UI must include its bundled JavaScript');
  assert.equal((await fetch(new URL(asset[1], url))).status, 200);
  await recordings.recordSession('Packaged consumer', { cpu: false, serverUrl: url });
  assert.equal(tracing.trace(() => 42, 'consumer.work')(), 42);
  const recording = await commonRecordings.releaseSession();
  const loaded = await createRecordingClient(url).load(recording.sessionId);
  assert.equal(loaded.sessionId, recording.sessionId);
  assert.ok(loaded.traces.length > 0);
  assert.ok(loaded.extensionSamples.some(sample => sample.channel === 'consumer.cache' && sample.data.hits === 7));
  const samples = await createSessionClient(url).samples(recording.sessionId, 'consumer.cache');
  assert.equal(samples.total, 1);
  assert.deepEqual(samples.items[0].data, { hits: 7 });
  console.log('PASS: ESM/CJS runtime identity, CLI, bundled UI, recording and consumer-extension upload/readback');
} finally {
  unregister();
  child.kill();
  await closed;
}
