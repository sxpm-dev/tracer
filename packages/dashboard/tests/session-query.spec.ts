// @vitest-environment node
import {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TraceEvent } from '../src/types';

import { analyzeCoreRecording } from '../src/coreAnalysis';
import { createRecordingClient } from '../src/recording';
import { startRecordingServer } from '../src/server';
import { createSessionClient } from '../src/sessionData';
import { queryFrames } from '../src/sessionQuery';

let directory: string;
let server: Awaited<ReturnType<typeof startRecordingServer>>;
let url: string;
beforeEach(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'trace-query-'));
  await writeFile(resolve(directory, 'index.html'), '<h1>Dashboard</h1>');
  server = await startRecordingServer({
    dashboardDirectory: directory,
    port: 0,
    recordingsDirectory: directory,
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('No server port');
  }
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await rm(directory, { force: true, recursive: true });
});
async function seed(
  lines: unknown[],
  mode: 'full' | 'light' = 'full',
  duration = 1_000,
) {
  await writeFile(
    resolve(directory, 'test.meta.json'),
    JSON.stringify({
      duration,
      mode,
      releasedAt: '2026-09-25T10:00:01Z',
      sessionId: 'test',
      startedAt: '2026-09-25T10:00:00Z',
      status: 'complete',
      title: 'Large recording',
      updatedAt: '2026-09-25T10:00:01Z',
    }),
  );
  await writeFile(
    resolve(directory, 'test.jsonl'),
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
  );
}
const event = (id: number, ray = 'first'): TraceEvent => ({
  arguments: ['private-payload'.repeat(100)],
  at: id,
  data: { detail: 'not-in-summary' },
  duration: id % 7,
  id,
  kind: 'call',
  name: id % 2 ? 'work' : 'root',
  namespace: 'app',
  ray,
  status: id % 9 ? 'ok' : 'error',
});
describe('page-scoped session data', () => {
  it('groups complete parent breadcrumbs and counts calls for each path', async () => {
    await seed([
      {
        events: [
          { ...event(1), name: 'bar' },
          { ...event(2), name: 'baz', parent: 1 },
          { ...event(3), name: 'foo', parent: 2 },
          { ...event(4), name: 'foo', parent: 2 },
          { ...event(5), name: 'foo', parent: 1 },
          { ...event(6), name: 'foo' },
        ],
        ray: 'first',
        type: 'events',
      },
      {
        events: [
          { ...event(1, 'second'), name: 'bar' },
          { ...event(2, 'second'), name: 'baz', parent: 1 },
          { ...event(3, 'second'), name: 'foo', parent: 2 },
        ],
        ray: 'second',
        type: 'events',
      },
    ]);
    const client = createSessionClient(url);
    const paths = await client.callPaths('test', {
      name: 'foo',
      namespace: 'app',
    });
    expect(
      paths.map((path) => ({
        calls: path.calls,
        names: path.frames.map((frame) => frame.name),
      })),
    ).toEqual([
      { calls: 3, names: ['bar', 'baz', 'foo'] },
      { calls: 1, names: ['bar', 'foo'] },
      { calls: 1, names: ['foo'] },
    ]);
    expect(
      (await client.callPaths('test', { name: 'foo', ray: 'second' }))[0].calls,
    ).toBe(1);
    expect(JSON.stringify(paths)).not.toContain('private-payload');
  });
  it('includes marker ancestors and preserves their frame type', async () => {
    await seed([
      {
        events: [
          { ...event(1), name: 'bar' },
          { ...event(2), kind: 'marker', name: 'checkpoint', parent: 1 },
          { ...event(3), name: 'foo', parent: 2 },
        ],
        ray: 'first',
        type: 'events',
      },
    ]);
    const paths = await createSessionClient(url).callPaths('test', {
      name: 'foo',
    });
    expect(paths).toEqual([
      {
        calls: 1,
        frames: [
          { kind: 'call', name: 'bar', namespace: 'app' },
          { kind: 'marker', name: 'checkpoint', namespace: 'app' },
          { kind: 'call', name: 'foo', namespace: 'app' },
        ],
      },
    ]);
  });
  it('returns only the top five functions for a limited overview query', async () => {
    await seed([
      {
        events: Array.from({ length: 7 }, (_, id) => ({
          ...event(id),
          duration: (id + 1) * 10,
          name: `function-${id}`,
        })),
        ray: 'first',
        type: 'events',
      },
    ]);
    const client = createSessionClient(url);
    const preview = await client.analytics('test', { functionLimit: 5 });
    expect(preview.functions.map((item) => item.name)).toEqual([
      'function-6',
      'function-5',
      'function-4',
      'function-3',
      'function-2',
    ]);
    expect(preview.total).toBe(7);
    expect((await client.analytics('test', {})).functions).toHaveLength(7);
  });

  it('matches full analysis across batches without returning events or payloads', async () => {
    await seed([
      {
        events: Array.from({ length: 250 }, (_, id) => event(id)),
        ray: 'first',
        type: 'events',
      },
      { events: [event(300, 'other')], ray: 'other', type: 'events' },
      { events: [event(400)], ray: 'first', type: 'events' },
      {
        sample: {
          at: 20,
          blockingDuration: 80,
          duration: 100,
          source: 'long-task',
        },
        type: 'cpu-sample',
      },
      {
        sample: {
          at: 1,
          metric: 'frame.fps',
          source: 'raf',
          unit: 'fps',
          value: 30,
        },
        type: 'browser-sample',
      },
      {
        sample: {
          at: 2,
          metric: 'frame.fps',
          source: 'raf',
          unit: 'fps',
          value: 60,
        },
        type: 'browser-sample',
      },
    ]);
    const full = await createRecordingClient(url).load('test');
    const summary = await createSessionClient(url).summary('test');
    const expected = analyzeCoreRecording(full);
    expect(summary.analysis).toEqual({ ...expected, rays: [] });
    expect(summary.recording.traces).toEqual([]);
    expect(
      summary.browser.series.find((item) => item.metric === 'frame.fps')!,
    ).toMatchObject({ count: 2 });
    expect(
      summary.browser.series.find((item) => item.metric === 'frame.fps')!
        .points[0],
    ).toBe(45);
    expect(JSON.stringify(summary)).not.toContain('private-payload');
    expect(JSON.stringify(summary)).not.toContain('not-in-summary');
    const filtered = await createSessionClient(url).summary('test', 'app.root');
    expect(filtered.analysis.activity).toEqual(
      analyzeCoreRecording(full, 'app.root').activity,
    );
    expect(filtered.analysis.functions).toEqual(
      analyzeCoreRecording(full, 'app.root').functions,
    );
  });
  it('pages rays and frames, searches all frames and fetches one full inspector payload', async () => {
    await seed([
      ...Array.from({ length: 105 }, (_, id) => ({
        events: [event(id, `r${id}`)],
        ray: `r${id}`,
        type: 'events',
      })),
      {
        events: Array.from({ length: 255 }, (_, id) => event(id)),
        ray: 'first',
        type: 'events',
      },
      {
        sample: {
          channel: 'tracing.ray-metadata',
          data: {
            owner: 'app.context',
            ray: 'first',
            value: { componentId: 'component-1' },
          },
        },
        type: 'extension-sample',
      },
      {
        sample: { channel: 'unknown.channel', data: 'do-not-load' },
        type: 'extension-sample',
      },
    ]);
    const client = createSessionClient(url);
    const rays = await client.rays('test');
    expect(rays.items).toHaveLength(100);
    expect(rays.total).toBe(106);
    expect((await client.rays('test', 100)).items).toHaveLength(6);
    const frames = await client.frames('test', {
      frame: 254,
      offset: 100,
      ray: 'first',
    });
    expect(frames.items).toHaveLength(100);
    expect(frames.items[0].id).toBe(100);
    expect(frames.total).toBe(255);
    expect(frames.items[0].arguments).toBeUndefined();
    expect(frames.selected?.arguments).toEqual(event(254).arguments);
    expect(frames.metadata).toEqual({
      'app.context': { componentId: 'component-1' },
    });
    const filtered = await client.frames('test', {
      query: 'work',
      ray: 'first',
    });
    expect(filtered.total).toBe(127);
    expect(filtered.items.every((item) => item.name === 'work')).toBe(true);
    expect(filtered.selected).toBeUndefined();
    expect(JSON.stringify(filtered)).not.toContain('private-payload');
    const custom = await client.samples('test', 'unknown.channel');
    expect(custom.total).toBe(1);
    expect(custom.items[0].data).toBe('do-not-load');
    expect((await client.samples('test', 'missing.channel')).total).toBe(0);
  });
  it('indexes global sorting, exact function filters, call children, and UTF-8 payload offsets', async () => {
    await seed([
      {
        events: [
          {
            ...event(0),
            arguments: ['שלום 🎨'],
            duration: 120,
            name: 'Рендер 🌈',
            parent: undefined,
          },
          { ...event(1), duration: 50, name: 'measure', parent: 0 },
        ],
        ray: 'first',
        type: 'events',
      },
      {
        events: [{ ...event(2, 'other'), duration: 80, name: 'measure' }],
        ray: 'other',
        type: 'events',
      },
    ]);
    const client = createSessionClient(url);
    const slowest = await client.frames('test', {
      minDuration: 10,
      sort: 'duration',
    });
    expect(slowest.items.map((item) => item.duration)).toEqual([120, 80, 50]);
    const children = await client.frames('test', { parent: 0, ray: 'first' });
    expect(children.items.map((item) => item.id)).toEqual([1]);
    const focused = await client.frames('test', {
      from: 0,
      name: 'measure',
      namespace: 'app',
      sort: 'duration-asc',
      to: 3,
    });
    expect(focused.items.map((item) => item.duration)).toEqual([50, 80]);
    const multi = await client.frames('test', {
      name: 'measure',
      namespace: JSON.stringify(['app', 'renderer']),
    });
    expect(multi.total).toBe(2);
    const excluded = await client.frames('test', {
      namespace: JSON.stringify(['data', 'renderer']),
    });
    expect(excluded.total).toBe(0);

    const selected = await client.frames('test', {
      frame: 0,
      frameRay: 'first',
    });
    expect(selected.selected?.arguments).toEqual(['שלום 🎨']);
    const before = await stat(
      resolve(directory, '.dashboard-index/test.sqlite'),
    );
    await client.summary('test');
    expect(
      (await stat(resolve(directory, '.dashboard-index/test.sqlite'))).mtimeMs,
    ).toBe(before.mtimeMs);
    await appendFile(
      resolve(directory, 'test.jsonl'),
      JSON.stringify({
        events: [event(10, 'new')],
        ray: 'new',
        type: 'events',
      }) + '\n',
    );
    expect((await client.frames('test', {})).total).toBe(4);
  });
  it('normalizes legacy event clocks in summaries, filters and inspection without rewriting recordings', async () => {
    await seed([
      {
        events: [
          { ...event(1), at: 5100 },
          { ...event(2), at: 5500 },
        ],
        ray: 'first',
        type: 'events',
      },
    ]);
    const metadataPath = resolve(directory, 'test.meta.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    await writeFile(
      metadataPath,
      JSON.stringify({ ...metadata, timelineOrigin: 5000 }),
    );
    const source = await readFile(resolve(directory, 'test.jsonl'), 'utf8');
    const client = createSessionClient(url);
    const frames = await client.frames('test', {
      frame: 1,
      frameRay: 'first',
      from: 90,
      to: 110,
    });
    expect(frames.items.map((item) => item.at)).toEqual([100]);
    expect(frames.selected?.at).toBe(100);
    const summary = await client.summary('test');
    const full = await createRecordingClient(url).load('test');
    expect(full.traces[0].events.map((item) => item.at)).toEqual([100, 500]);
    expect(summary.analysis.activity).toEqual(
      analyzeCoreRecording(full).activity,
    );
    expect(await readFile(resolve(directory, 'test.jsonl'), 'utf8')).toBe(
      source,
    );
  });
  it('aggregates filtered call times into bounded buckets and pages call tree levels', async () => {
    await seed([
      {
        events: Array.from({ length: 10000 }, (_, id) => ({
          ...event(id),
          at: id / 10,
          duration: id % 10,
          parent: id ? 0 : undefined,
        })),
        ray: 'first',
        type: 'events',
      },
    ]);
    const client = createSessionClient(url);
    const metaPath = resolve(directory, 'test.meta.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    await writeFile(metaPath, JSON.stringify({ ...meta, duration: 240000 }));
    const data = await client.analytics('test', {
      from: 100,
      maxDuration: 5,
      minDuration: 3,
      namespace: 'app',
      to: 200,
    });
    expect(data.total).toBe(300);
    // Four minutes would be 240 one-second marks, so the buckets widen to
    // stay within the cap. chartCounts is the same series the explorer draws.
    expect(data.counts.length).toBe(120);
    expect(data.counts.reduce((a, b) => a + b, 0)).toBe(300);
    expect(data.bucketMs).toBe(2_000);
    expect(data.chartCounts).toHaveLength(120);
    expect(data.chartCounts.reduce((a, b) => a + b, 0)).toBe(300);
    expect(data.chartRootCounts.reduce((a, b) => a + b, 0)).toBe(0);
    expect(data.rootTotal).toBe(0);
    expect(data.functions.reduce((n, f) => n + f.calls, 0)).toBe(300);
    const complete = await client.analytics('test', { to: 100 });
    expect(complete.rootTotal).toBe(1);
    expect(complete.chartRootCounts.reduce((a, b) => a + b, 0)).toBe(1);
    const roots = await client.frames('test', {
      ray: 'first',
      rootsOnly: true,
    });
    expect(roots.items.map((item) => item.id)).toEqual([0]);
    const children = await client.frames('test', {
      offset: 100,
      parent: 0,
      ray: 'first',
    });
    expect(children.total).toBe(9999);
    expect(children.items).toHaveLength(100);
    expect(children.items[0].id).toBe(101);
    expect(JSON.stringify(data)).not.toContain('private-payload');
  });
  it('supports light summaries without fabricating frames', async () => {
    const aggregate = {
      argumentExample: ['private-payload'],
      calls: 8,
      errors: 1,
      maxDuration: 200,
      minDuration: 1,
      name: 'run',
      namespace: 'app',
      totalDuration: 240,
    };
    await seed(
      [
        { aggregate, type: 'aggregate' },
        {
          type: 'function-window',
          window: {
            at: 0,
            functions: [aggregate],
            otherCalls: 2,
            otherDuration: 4,
            span: 200,
          },
        },
      ],
      'light',
    );
    const summary = await createSessionClient(url).summary('test');
    expect(summary.analysis.calls).toBe(8);
    expect(
      summary.analysis.activity.reduce((sum, calls) => sum + calls, 0),
    ).toBeCloseTo(10);
    expect(summary.analysis.activity).toEqual([10]);
    expect(summary.analysis.rootActivity).toBeUndefined();
    const preview = summary.browser.functions
      .flat()
      .filter(([name]) => name === 'app.run');
    expect(preview.reduce((sum, [, item]) => sum + item.calls, 0)).toBeCloseTo(
      8,
    );
    expect(
      preview.reduce((sum, [, item]) => sum + item.duration, 0),
    ).toBeCloseTo(240);
    expect(summary.analysis.rays).toEqual([]);
    expect(summary.recording.mode).toBe('light');
    expect(JSON.stringify(summary)).not.toContain('private-payload');
  });
  it('cancels a disk scan without leaving a reader running', async () => {
    await seed(
      Array.from({ length: 2000 }, (_, id) => ({
        events: [event(id)],
        ray: 'first',
        type: 'events',
      })),
    );
    const controller = new AbortController();
    const pending = queryFrames(
      resolve(directory, 'test.jsonl'),
      new URLSearchParams({ ray: 'first' }),
      controller.signal,
    );
    setImmediate(() => controller.abort());
    await expect(pending).rejects.toThrow();
    expect((await createSessionClient(url).rays('test')).total).toBe(1);
  });
  it('serves direct dashboard links, keeps missing assets/API errors as 404, and accepts cancellation', async () => {
    expect(
      await fetch(`${url}/sessions/test/frames?ray=first&frame=2`).then(
        (response) => response.text(),
      ),
    ).toContain('Dashboard');
    expect((await fetch(`${url}/sessions/test/editor%2Finfo`)).status).toBe(
      200,
    );
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404);
    await expect(createSessionClient(url).summary('missing')).rejects.toThrow(
      'no longer available',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      createSessionClient(url).summary('test', '', controller.signal),
    ).rejects.toThrow();
  });
});

it('summarizes legacy heap and blocking into bounded runtime bars', async () => {
  await seed(
    [
      {
        events: [
          {
            ...event(1),
            memory: { deltaBytes: 90, endBytes: 100, startBytes: 10 },
          },
          {
            ...event(2),
            memory: { deltaBytes: 100, endBytes: 200, startBytes: 100 },
          },
        ],
        ray: 'first',
        type: 'events',
      },
      {
        sample: { at: 1, blockingDuration: 25, duration: 75 },
        type: 'cpu-sample',
      },
      {
        events: [
          {
            ...event(3),
            at: 3_500,
            memory: { deltaBytes: 10, endBytes: 60, startBytes: 50 },
          },
        ],
        ray: 'second',
        type: 'events',
      },
      // Five seconds long, so the runtime bars span five buckets with a gap.
    ],
    'full',
    5_000,
  );
  const result = await createSessionClient(url).summary('test');
  const heap = result.browser.series.find(
    (item: { metric: string }) => item.metric === 'memory.js-heap-high-water',
  );
  expect(heap!.points).toHaveLength(5);
  expect(heap!.points[0]).toBe(200);
  expect(heap!.points[3]).toBe(60);
  expect(heap!.counts[1]).toBe(0);
  expect(
    result.browser.series.find(
      (item: { metric: string }) => item.metric === 'thread.blocking',
    )!.points[0],
  ).toBe(25);
});

it('pages expanded descendants with child counts and ancestor paths', async () => {
  await seed([
    {
      events: [
        { ...event(1), parent: undefined },
        { ...event(2), parent: 1 },
        { ...event(3), parent: 2 },
        { ...event(4), parent: 1 },
      ],
      ray: 'first',
      type: 'events',
    },
  ]);
  const client = createSessionClient(url);
  const roots = await client.frames('test', { rootsOnly: true });
  expect(roots.items).toHaveLength(1);
  expect(roots.items[0].childCount).toBe(2);
  const stack = await client.frames('test', { ray: 'first', subtree: 1 });
  expect(stack.items.map((item) => item.id)).toEqual([1, 2, 3, 4]);
  expect(stack.items.map((item) => item.depth)).toEqual([0, 1, 2, 1]);
  expect(stack.items[0].ancestors).toEqual([]);
  expect(stack.items[0].childCount).toBe(2);
  expect(stack.items[2].ancestors).toEqual([
    { id: 1, name: event(1).name },
    { id: 2, name: event(2).name },
  ]);
  expect(stack.items[2].childCount).toBe(0);
});

it('exports every function and root in one streamed request without trace payloads', async () => {
  const events = Array.from({ length: 12_000 }, (_, index) => ({
    ...event(index + 1, `ray-${Math.floor(index / 100)}`),
    name:
      index % 100 === 0
        ? `root-${Math.floor(index / 100)}`
        : `function-${index % 100}`,
    parent: index % 100 === 0 ? undefined : Math.floor(index / 100) * 100 + 1,
  }));
  await seed(
    events.map((item) => ({ events: [item], ray: item.ray, type: 'events' })),
  );
  const client = createSessionClient(url);
  const progress: number[] = [];
  const result = await client.exportSnapshot('test', undefined, (value) =>
    progress.push(value),
  );
  expect(result.summary.analysis.calls).toBe(12_000);
  expect(result.scopes).toHaveLength(121);
  expect(result.scopes[0].functions).toHaveLength(219);
  expect(result.pathNodes!.length).toBeLessThanOrEqual(12_000);
  expect(
    result.scopes[0].functions.every(
      (item) => !item.paths && item.pathCounts!.length,
    ),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain('private-payload');
  expect(JSON.stringify(result)).not.toContain('not-in-summary');
  expect(result.summary.recording.traces).toEqual([]);
  expect(progress.length).toBeGreaterThan(2);
  expect(progress.at(-1)).toBe(1);
  for (const root of ['app.root-0', 'app.root-119']) {
    const expected = await client.summary('test', root);
    const exported = result.scopes.find((scope) => scope.root === root)!;
    expect(exported.analysis.calls).toBe(expected.analysis.calls);
    expect(exported.analysis.activity).toEqual(expected.analysis.activity);
    const expectedPaths = await client.callPaths('test', {
      name: 'function-1',
      namespace: 'app',
      root,
    });
    const fn = exported.functions.find(
      (item) => item.stat.name === 'function-1',
    )!;
    expect(fn.pathCounts!.reduce((sum, [, calls]) => sum + calls, 0)).toBe(
      expectedPaths.reduce((sum, path) => sum + path.calls, 0),
    );
  }
});

it('cancels a streamed export without leaving the server unusable', async () => {
  await seed([
    {
      events: Array.from({ length: 30_000 }, (_, id) => event(id)),
      ray: 'first',
      type: 'events',
    },
  ]);
  const client = createSessionClient(url);
  const controller = new AbortController();
  await expect(
    client.exportSnapshot('test', controller.signal, () => controller.abort()),
  ).rejects.toThrow();
  expect((await client.summary('test')).analysis.calls).toBe(30_000);
});
