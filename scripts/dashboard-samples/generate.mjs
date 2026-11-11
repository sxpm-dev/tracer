import { mkdir, open, readFile, rename, rm, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { scenarios } from './scenarios.mjs';

export const GENERATOR_VERSION = 1;
const START = Date.parse('2026-11-11T10:00:00.000Z');
const metricNames = ['frame.fps', 'timer.lag', 'memory.js-heap-used', 'event.input-delay', 'resource.duration', 'resource.transfer-size'];
const round = value => Math.round(value * 1000) / 1000;
export function sampleIdentity(domain, samples) {
  if (!Object.hasOwn(scenarios, domain)) throw new Error(`Unknown scenario: ${domain}`);
  if (!Number.isSafeInteger(samples) || samples < 100 || samples > 2_000_000) throw new Error('samples must be an integer between 100 and 2000000');
  return `sample-${domain}-v${GENERATOR_VERSION}-${samples}`;
}

/** One bounded frame at a time. --samples counts events + browser + CPU + extension observations. */
export function* recordingLines(domain, samples) {
  const sessionId = sampleIdentity(domain, samples);
  const spec = scenarios[domain];
  let observations = 0, frame = 0, clock = 0;
  while (observations < samples) {
    const remaining = samples - observations;
    const phase = frame % 1200;
    const hot = phase >= 400 && phase < 580;
    const recovery = phase >= 580 && phase < 700;
    const load = hot ? 4.5 : recovery ? 1.8 : 1;
    const elapsed = round((7.5 + (frame % 13) * .22) * load);
    const ray = `${domain}-frame-${frame}`;
    // 1 root + 4 subsystem calls + 8 child calls per subsystem + 1 marker = 38 events.
    const eventCount = Math.min(38, remaining);
    const events = [{ id: 1, ray, name: spec.operation, namespace: spec.namespaces[0], kind: 'call', at: round(clock), duration: elapsed, status: 'ok' }];
    for (let subsystem = 0; subsystem < 4 && events.length < eventCount; subsystem++) {
      const at = clock + elapsed * (.02 + subsystem * .24);
      const duration = elapsed * .23;
      const parent = events.length + 1;
      events.push({ id: parent, ray, parent: 1, kind: 'call', namespace: spec.namespaces[subsystem], name: spec.jobs[subsystem], at: round(at), duration: round(duration), status: 'ok' });
      for (let task = 0; task < 8 && events.length < eventCount; task++) {
        const failed = hot && subsystem === 3 && task === 7 && frame % 97 === 0;
        events.push({ id: events.length + 1, ray, parent, kind: 'call', namespace: spec.namespaces[subsystem], name: spec.tasks[subsystem], at: round(at + task * duration / 8), duration: round(duration / 9), status: failed ? 'error' : 'ok', ...(failed ? {error:{name:'RetryableError',message:'Synthetic workload: update deferred until next frame'}} : {}) });
      }
    }
    if (events.length < eventCount) events.push({ id: events.length + 1, ray, parent: 1, kind: 'marker', namespace: spec.namespaces[0], name: hot ? spec.incident : 'frame-complete', at: round(clock + elapsed), data: { synthetic: true, phase: hot ? 'stress' : recovery ? 'recovery' : 'steady' } });
    yield { type: 'events', ray, events, metadata: { 'sample.scenario': { synthetic: true, domain, version: GENERATOR_VERSION, frame, phase: hot ? 'stress' : recovery ? 'recovery' : 'steady', ...spec.detail } } };
    observations += events.length;
    const available = () => observations < samples;
    if (frame % 15 === 0 && available()) {
      const cacheHit = !hot || Math.floor(frame / 15) % 3 === 0;
      const values = [elapsed <= 16.667 ? 60 : 1000 / elapsed, Math.max(0, elapsed - 16.667), (spec.heapMb + (frame % 1200) * .025 + (hot ? 65 : 0)) * 1024 * 1024, hot ? 45 + frame % 35 : 3 + frame % 5, cacheHit ? 3 : 90 + frame % 80, cacheHit ? 0 : 180000 + frame % 9000];
      const units = ['fps','ms','bytes','ms','ms','bytes'];
      for (let metric = 0; metric < metricNames.length && available(); metric++) {
        yield { type:'browser-sample', sample:{ at:round(clock), metric:metricNames[metric], unit:units[metric], value:round(values[metric]), source:'synthetic-workload', detail:{ synthetic: 1, ...(metric >= 4 ? {name:spec.resource, cacheHit:Number(cacheHit)} : {}) } } };
        observations++;
      }
      if (available()) {
        yield { type:'extension-sample', sample:{at:round(clock),channel:spec.channel,data:{version:1,synthetic:true,ray,frame,cacheHit,queueDepth:hot ? 25 + frame % 20 : frame % 4,...spec.detail}} };
        observations++;
      }
    }
    // An occasional main-thread stall shares the same stress window as FPS/input-delay changes.
    if (hot && frame % 30 === 0 && available()) {
      yield { type:'cpu-sample',sample:{at:round(clock),duration:elapsed + 40,blockingDuration:Math.max(0,elapsed - 10),source:'long-task',scripts:[{functionName:spec.jobs[2],duration:elapsed + 40,sourceUrl:`https://sample.invalid/${domain}/renderer.js`}]}};
      observations++;
      clock += 40;
    }
    clock += Math.max(16.667, elapsed + 1);
    frame++;
  }
}

export async function generateRecording(directory, domain, samples, onProgress = () => {}) {
  const id = sampleIdentity(domain, samples);
  const metaPath = join(directory, `${id}.meta.json`);
  await mkdir(directory, { recursive: true });
  const existing = await readFile(metaPath, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (existing) {
    const size = (await stat(join(directory, `${id}.jsonl`))).size;
    if (existing.sampleGenerator?.version !== GENERATOR_VERSION || existing.sampleGenerator?.samples !== samples || existing.sampleGenerator?.bytes !== size) throw new Error(`Refusing to overwrite existing or modified recording ${id}`);
    return { ...existing, reused: true };
  }
  for (const suffix of ['jsonl', 'rays', 'deleted']) {
    try { await access(join(directory, `${id}.${suffix}`)); }
    catch(error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error(`Recording ${id} has existing data or was deleted. Use a different sample count or remove its sample files deliberately.`);
  }
  // Exclusive lock prevents two launchers publishing the same recording concurrently.
  const lockPath = join(directory, `${id}.sample-lock`);
  const lock = await open(lockPath, 'wx');
  const temporary = join(directory, `${id}.${process.pid}.tmp`);
  let data, rays;
  try {
    data = await open(`${temporary}.jsonl`, 'wx');
    rays = await open(`${temporary}.rays`, 'wx');
    const counts = { eventCount:0, traceCount:0, browserSampleCount:0, cpuSampleCount:0, extensionSampleCount:0 };
    let buffer = '', rayBuffer = '', duration = 0, observations = 0, nextProgress = 250000;
    for (const line of recordingLines(domain, samples)) {
      buffer += JSON.stringify(line) + '\n';
      if (line.type === 'events') {
        counts.eventCount += line.events.length; counts.traceCount++; observations += line.events.length;
        rayBuffer += `${line.ray}\n`;
        duration = Math.max(duration, ...line.events.map(event => event.at + (event.duration ?? 0)));
      } else {
        observations++;
        counts[line.type === 'browser-sample' ? 'browserSampleCount' : line.type === 'cpu-sample' ? 'cpuSampleCount' : 'extensionSampleCount']++;
        duration = Math.max(duration, line.sample.at + (line.sample.duration ?? 0));
      }
      if (buffer.length >= 512 * 1024) { await data.writeFile(buffer); buffer = ''; await rays.writeFile(rayBuffer); rayBuffer = ''; }
      if (observations >= nextProgress) { onProgress(observations); nextProgress += 250000; }
    }
    if (buffer) await data.writeFile(buffer);
    if (rayBuffer) await rays.writeFile(rayBuffer);
    await data.close(); data = undefined; await rays.close(); rays = undefined;
    const bytes = (await stat(`${temporary}.jsonl`)).size;
    const startedAt = new Date(START).toISOString(), releasedAt = new Date(START + duration).toISOString();
    const metadata = { sessionId:id,title:`[SYNTHETIC] ${scenarios[domain].title}`,mode:'full',status:'complete',startedAt,dataStartedAt:startedAt,releasedAt,updatedAt:releasedAt,timelineOrigin:0,duration:round(duration),rayIndexComplete:true,...counts,cpuSource:'long-task',browserCapabilities:['frame-rate','timer-lag','memory','event','resource'].map(name=>({name,status:'active',reason:'Synthetic demonstration signal; not measured browser data'})),sampleGenerator:{version:GENERATOR_VERSION,domain,samples,bytes} };
    await rename(`${temporary}.jsonl`, join(directory, `${id}.jsonl`));
    await rename(`${temporary}.rays`, join(directory, `${id}.rays`));
    await open(`${temporary}.meta.json`, 'wx').then(async file => { try { await file.writeFile(JSON.stringify(metadata,null,2)); } finally { await file.close(); } });
    await rename(`${temporary}.meta.json`, metaPath); // Publish only after all data is present.
    return { ...metadata, reused:false };
  } finally {
    await data?.close(); await rays?.close(); await lock.close();
    await Promise.all(['jsonl','rays','meta.json'].map(suffix=>rm(`${temporary}.${suffix}`,{force:true})));
    await rm(lockPath,{force:true});
  }
}
