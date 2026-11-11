import {
  addTraceExtensionSample,
  recordSession,
  registerTraceCollector,
  releaseSession,
  setTraceRayMetadata,
  trace,
} from '@sx/recordings';
// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecordingClient, createSessionClient, parseRecording } from '../src/data';
import { startRecordingServer } from '../src/server';

let directory: string;
let server: Awaited<ReturnType<typeof startRecordingServer>>;
afterEach(async () => {
  if (server) {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
  if (directory) {
    await rm(directory, { force: true, recursive: true });
  }
});
describe('server and transport', () => {
  it.each(['full', 'light'] as const)('preserves independent consumer collectors through %s sessions', async (mode) => {
    directory = await mkdtemp(resolve(tmpdir(), 'trace-extensions-'));
    await writeFile(resolve(directory, 'index.html'), '<h1>Consumer dashboard</h1>');
    server = await startRecordingServer({ port: 0, recordingsDirectory: resolve(directory, 'recordings'), dashboardDirectory: directory });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    const url = `http://127.0.0.1:${address.port}`;
    const unregisterCache = registerTraceCollector({
      name: 'shop.cache',
      onStart: () => addTraceExtensionSample('shop.cache', { version: 1, hits: 7 }),
      onStop: () => addTraceExtensionSample('shop.cache', { version: 1, hits: 9 }),
      decorate: recording => ({ ...recording, extensionSamples: [
        ...(recording.extensionSamples ?? []),
        { at: recording.duration, channel: 'shop.summary', data: { hitRate: 0.75 } },
      ] }),
    });
    const unregisterQueue = registerTraceCollector({
      name: 'worker.queue',
      onStop: () => addTraceExtensionSample('worker.queue', { depth: 3 }),
    });
    try {
      await recordSession('Consumer extensions', { cpu: false, serverUrl: url, mode });
      trace(() => 42, 'work')();
      const released = await releaseSession();
      const loaded = await createRecordingClient(url).load(released.sessionId);
      expect(loaded.extensionSamples).toEqual(released.extensionSamples);
      const client = createSessionClient(url);
      const caches = await client.samples(released.sessionId, 'shop.cache');
      expect(caches.total).toBe(2);
      expect(caches.items.map(sample => sample.data)).toEqual([
        { version: 1, hits: 7 }, { version: 1, hits: 9 },
      ]);
      const queue = await client.samples(released.sessionId, 'worker.queue');
      expect(queue.total).toBe(1);
      expect(queue.items[0].data).toEqual({ depth: 3 });
      const summary = await client.samples(released.sessionId, 'shop.summary');
      expect(summary.total).toBe(1);
      expect(summary.items[0].data).toEqual({ hitRate: 0.75 });
    } finally {
      unregisterQueue();
      unregisterCache();
    }
  });

  it('serves custom UI and round-trips ray metadata and unknown channels', async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'trace-package-'));
    await writeFile(
      resolve(directory, 'index.html'),
      '<h1>Custom dashboard</h1>',
    );
    server = await startRecordingServer({
      dashboardDirectory: directory,
      port: 0,
      recordingsDirectory: resolve(directory, 'recordings'),
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing port');
    }
    const url = `http://127.0.0.1:${address.port}`;
    expect(await fetch(url).then((response) => response.text())).toContain(
      'Custom dashboard',
    );
    for (const path of [
      '/sample/full/overview',
      '/sample/light/overview',
      '/sample/full/frames?frame=2',
      '/reports?session=first&session=second',
    ]) {
      const response = await fetch(url + path);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('Custom dashboard');
    }
    await recordSession('Round trip', { cpu: false, serverUrl: url });
    trace(() => {
      setTraceRayMetadata('example.context', { component: 'one' });
      addTraceExtensionSample('unknown.channel', { value: 42 });
    }, 'resize')();
    const released = await releaseSession();
    const client = createRecordingClient(url);
    const loaded = await client.load(released.sessionId);
    expect(loaded.traces[0].metadata).toEqual(released.traces[0].metadata);
    expect(
      loaded.extensionSamples?.some(
        (sample) => sample.channel === 'unknown.channel',
      ),
    ).toBe(true);
    expect(parseRecording(JSON.stringify(released)).traces[0].metadata).toEqual(
      released.traces[0].metadata,
    );
    await recordSession('Browser only', {
      browser: { frameRate: false, memory: 'off', timerLag: false },
      cpu: false,
      mode: 'browser',
      serverUrl: url,
    });
    trace(() => 42, 'ignored')();
    const browserOnly = await releaseSession();
    const loadedBrowserOnly = await client.load(browserOnly.sessionId);
    expect(loadedBrowserOnly.mode).toBe('browser');
    expect(loadedBrowserOnly.traces).toEqual([]);
    expect(await client.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'complete', title: 'Round trip' }),
        expect.objectContaining({ mode: 'browser', title: 'Browser only' }),
      ]),
    );
  });
});
