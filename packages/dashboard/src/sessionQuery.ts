import { createReadStream } from 'node:fs';
import { stat as fileStat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import type {
  TraceBrowserSample,
  TraceCpuSample,
  TraceEvent,
  TraceExtensionSample,
  TraceFunctionAggregate,
  TraceFunctionWindow,
  TraceRecording,
} from './types';

import {
  analyzeCoreRecording,
  type CoreFunctionStat,
  type CoreRay,
  functionKey,
  TIMELINE_BUCKETS,
} from './coreAnalysis';
import {
  distributeLightWindow,
  distributeLightWindowBySecond,
  lightWindowCrossesSecond,
  oneSecondBuckets,
  secondIndex,
} from './lightWindowBuckets';
import { addEventMemory, addRuntimeSample } from './runtimeSeries';
import {
  type BrowserSeries,
  type FramePage,
  SESSION_PAGE_SIZE,
  type SessionSummary,
} from './sessionData';

type Line = {
  aggregate?: TraceFunctionAggregate;
  events?: TraceEvent[];
  ray?: string;
  sample?: TraceBrowserSample | TraceCpuSample | TraceExtensionSample;
  type: string;
  window?: TraceFunctionWindow;
};

/** Reads a fixed byte snapshot; no recording-sized string or event array. */
async function scan(
  path: string,
  consume: (line: Line) => void,
  signal: AbortSignal,
  snapshotSize?: number,
) {
  const size = snapshotSize ?? (await fileStat(path)).size;
  if (!size) {
    return;
  }
  const stream = createReadStream(path, { end: size - 1, signal });
  const lines = createInterface({ crlfDelay: Infinity, input: stream });
  try {
    for await (const line of lines) {
      signal.throwIfAborted();
      if (line.trim()) {
        consume(JSON.parse(line) as Line);
      }
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}
const buckets = () => Array<number>(TIMELINE_BUCKETS).fill(0);
function bucket(at: number, duration: number) {
  return Math.max(
    0,
    Math.min(
      TIMELINE_BUCKETS - 1,
      Math.floor((at / Math.max(duration, 1)) * TIMELINE_BUCKETS),
    ),
  );
}
function mergeStat(
  target: Map<string, CoreFunctionStat>,
  next: CoreFunctionStat,
) {
  const key = functionKey(next.namespace, next.name);
  const previous = target.get(key);
  target.set(
    key,
    previous
      ? {
          ...previous,
          calls: previous.calls + next.calls,
          errors: previous.errors + next.errors,
          maxDuration: Math.max(previous.maxDuration, next.maxDuration),
          minDuration: Math.min(previous.minDuration, next.minDuration),
          totalDuration: previous.totalDuration + next.totalDuration,
        }
      : next,
  );
}
function statFor(event: TraceEvent): CoreFunctionStat {
  return {
    calls: 1,
    errors: Number(event.status === 'error'),
    maxDuration: event.duration ?? 0,
    minDuration: event.duration ?? 0,
    name: event.name,
    namespace: event.namespace || 'unknown',
    totalDuration: event.duration ?? 0,
  };
}
function addRay(rays: Map<string, CoreRay>, event: TraceEvent, id: string) {
  const previous = rays.get(id) ?? {
    calls: 0,
    duration: 0,
    errors: 0,
    name: `${event.namespace || 'unknown'}.${event.name}`,
    ray: id,
    startedAt: event.at,
  };
  const startedAt = Math.min(previous.startedAt, event.at);
  const end = Math.max(
    previous.startedAt + previous.duration,
    event.at + (event.duration ?? 0),
  );
  rays.set(id, {
    ...previous,
    calls: previous.calls + 1,
    duration: end - startedAt,
    errors: previous.errors + Number(event.status === 'error'),
    startedAt,
  });
}
async function collectRays(
  path: string,
  signal: AbortSignal,
  snapshotSize?: number,
) {
  const rays = new Map<string, CoreRay>();
  await scan(path, (line) => collectRayLine(rays, line), signal, snapshotSize);
  return rays;
}
function collectRayLine(rays: Map<string, CoreRay>, line: Line) {
  if (line.type === 'events' && line.ray) {
    for (const event of line.events ?? []) {
      if (event.kind === 'call') {
        addRay(rays, event, line.ray);
      }
    }
  }
}
function collectBrowser(
  series: Map<string, BrowserSeries>,
  sample: TraceBrowserSample,
  duration: number,
) {
  const item = series.get(sample.metric) ?? {
    count: 0,
    counts: oneSecondBuckets(duration),
    metric: sample.metric,
    points: oneSecondBuckets(duration),
    unit: sample.unit,
  };
  const index = secondIndex(sample.at, item.points.length, duration);
  const average = /memory|fps|visibility/.test(sample.metric);
  item.points[index] = average
    ? (item.points[index] * item.counts[index] + sample.value) /
      (item.counts[index] + 1)
    : Math.max(item.points[index], sample.value);
  item.counts[index] += 1;
  item.count += 1;
  series.set(sample.metric, item);
}
function createAccumulator(recording: TraceRecording, eventOffset = 0) {
  return {
    activity: oneSecondBuckets(recording.duration),
    activityEstimated: false,
    activityWindowCalls: 0,
    blocking: buckets(),
    eventOffset,
    functions: new Map<string, CoreFunctionStat>(),
    longestBlock: 0,
    recording,
    rootActivity: oneSecondBuckets(recording.duration),
    series: new Map<string, BrowserSeries>(),
    slices: Array.from(
      { length: TIMELINE_BUCKETS },
      () => new Map<string, CoreFunctionStat>(),
    ),
    timelineBlocking: oneSecondBuckets(recording.duration),
  };
}
type Accumulator = ReturnType<typeof createAccumulator>;
function collectSample(state: Accumulator, line: Line) {
  if (line.type === 'browser-sample' && line.sample) {
    collectBrowser(
      state.series,
      line.sample as TraceBrowserSample,
      state.recording.duration,
    );
  }
  if (line.type === 'cpu-sample' && line.sample) {
    const sample = line.sample as TraceCpuSample;
    addRuntimeSample(
      state.series,
      'thread.blocking',
      sample.at,
      sample.blockingDuration,
      state.recording.duration,
      'ms',
    );
    state.blocking[bucket(sample.at, state.recording.duration)] +=
      sample.blockingDuration;
    state.timelineBlocking[
      secondIndex(
        sample.at,
        state.timelineBlocking.length,
        state.recording.duration,
      )
    ] += sample.blockingDuration;
    state.longestBlock = Math.max(state.longestBlock, sample.blockingDuration);
  }
}
function collectSummary(
  state: Accumulator,
  line: Line,
  rays: Map<string, CoreRay>,
  root: string,
) {
  collectSample(state, line);
  collectMemory(state, line);
  if (state.recording.mode === 'light') {
    collectLight(state, line);
    return;
  }
  if (
    line.type !== 'events' ||
    (root && rays.get(line.ray ?? '')?.name !== root)
  ) {
    return;
  }
  for (const event of line.events ?? []) {
    if (event.kind !== 'call') {
      continue;
    }
    const index = bucket(
      Math.max(0, event.at - state.eventOffset),
      state.recording.duration,
    );
    const stat = statFor(event);
    mergeStat(state.functions, stat);
    mergeStat(state.slices[index], stat);
    const second = secondIndex(
      Math.max(0, event.at - state.eventOffset),
      state.activity.length,
      state.recording.duration,
    );
    state.activity[second] += 1;
    state.rootActivity[second] += Number(event.parent == null);
  }
}
function collectLight(state: Accumulator, line: Line) {
  if (line.type === 'aggregate' && line.aggregate) {
    // Aggregate records contain cumulative snapshots; the last one wins.
    const {
      calls,
      errors,
      maxDuration,
      minDuration,
      name,
      namespace,
      totalDuration,
    } = line.aggregate;
    state.functions.set(functionKey(namespace, name), {
      calls,
      errors,
      maxDuration,
      minDuration,
      name,
      namespace,
      totalDuration,
    });
  }
  if (line.type === 'function-window' && line.window) {
    const window = line.window;
    const calls =
      window.functions.reduce((total, stat) => total + stat.calls, 0) +
      window.otherCalls;
    state.activityWindowCalls += calls;
    state.activityEstimated ||= lightWindowCrossesSecond(
      window,
      state.recording.duration,
    );
    distributeLightWindowBySecond(
      window,
      state.recording.duration,
      (index, share) => {
        state.activity[index] += calls * share;
      },
    );
    distributeLightWindow(
      window,
      state.recording.duration,
      TIMELINE_BUCKETS,
      (index, share) => {
        for (const stat of window.functions) {
          mergeStat(state.slices[index], {
            ...stat,
            calls: stat.calls * share,
            errors: stat.errors * share,
            minDuration: 0,
            totalDuration: stat.totalDuration * share,
          });
        }
      },
    );
  }
}
export async function querySummary(
  path: string,
  recording: TraceRecording,
  root: string,
  signal: AbortSignal,
  snapshotSize?: number,
  eventOffset = 0,
): Promise<SessionSummary> {
  const rays = root
    ? await collectRays(path, signal)
    : new Map<string, CoreRay>();
  const state = createAccumulator(recording, eventOffset);
  await scan(
    path,
    (line) => {
      if (!root) {
        collectRayLine(rays, line);
      }
      collectSummary(state, line, rays, root);
    },
    signal,
    snapshotSize,
  );
  const analysis = analyzeCoreRecording({
    ...recording,
    aggregates: [...state.functions.values()],
    cpuSamples: [
      {
        at: 0,
        blockingDuration: state.longestBlock,
        duration: state.longestBlock,
        source: 'long-task',
      },
    ],
    mode: 'light',
  });
  const roots = new Map<string, { calls: number; key: string; rays: number }>();
  for (const ray of rays.values()) {
    const item = roots.get(ray.name) ?? { calls: 0, key: ray.name, rays: 0 };
    item.calls += ray.calls;
    item.rays += 1;
    roots.set(ray.name, item);
  }
  return {
    analysis: {
      ...analysis,
      activity: state.activity,
      activityEstimated:
        recording.mode === 'light' &&
        (state.activityEstimated ||
          state.activityWindowCalls !== analysis.calls ||
          Boolean(recording.droppedFunctionWindows)),
      blocking: state.blocking,
      blockingTotal: state.blocking.reduce((sum, value) => sum + value, 0),
      rootActivity: recording.mode === 'light' ? undefined : state.rootActivity,
      roots: [...roots.values()].sort((a, b) => b.calls - a.calls),
      timelineBlocking: state.timelineBlocking,
    },
    browser: {
      functions: state.slices.map((slice) =>
        [...slice.values()]
          .sort((a, b) => b.totalDuration - a.totalDuration)
          .slice(0, 5)
          .map((item) => [
            `${item.namespace}.${item.name}`,
            { calls: item.calls, duration: item.totalDuration },
          ]),
      ),
      series: [...state.series.values()],
    },
    recording,
  };
}
export function queryOffset(params: URLSearchParams) {
  const value = Number(params.get('offset'));
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
export async function queryRays(
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
) {
  const query = (params.get('q') ?? '').toLowerCase();
  const rays = [...(await collectRays(path, signal)).values()]
    .filter((item) => `${item.name} ${item.ray}`.toLowerCase().includes(query))
    .sort((a, b) => a.startedAt - b.startedAt);
  const offset = queryOffset(params);
  return {
    items: rays.slice(offset, offset + SESSION_PAGE_SIZE),
    offset,
    total: rays.length,
  };
}
function compactEvent(event: TraceEvent): TraceEvent {
  const { at, duration, id, kind, name, namespace, parent, ray, status } =
    event;
  return { at, duration, id, kind, name, namespace, parent, ray, status };
}
export async function queryFrames(
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<FramePage> {
  const ray = params.get('ray') ?? '';
  const query = (params.get('q') ?? '').toLowerCase();
  const selectedId = params.has('frame')
    ? Number(params.get('frame'))
    : undefined;
  const page: FramePage = { items: [], offset: queryOffset(params), total: 0 };
  await scan(
    path,
    (line) => {
      collectMetadata(page, line, ray);
      if (line.type !== 'events' || line.ray !== ray) {
        return;
      }
      for (const event of line.events ?? []) {
        if (event.id === selectedId) {
          page.selected = event;
        }
        if (
          !`${event.namespace ?? ''}.${event.name}`
            .toLowerCase()
            .includes(query)
        ) {
          continue;
        }
        if (
          page.total >= page.offset &&
          page.items.length < SESSION_PAGE_SIZE
        ) {
          page.items.push(compactEvent(event));
        }
        page.total += 1;
      }
    },
    signal,
  );
  return page;
}
function collectMetadata(page: FramePage, line: Line, ray: string) {
  if (line.type !== 'extension-sample' || !line.sample) {
    return;
  }
  const sample = line.sample as TraceExtensionSample<{
    owner: string;
    ray: string;
    value: unknown;
  }>;
  if (sample.channel === 'tracing.ray-metadata' && sample.data?.ray === ray) {
    page.metadata = {
      ...page.metadata,
      [sample.data.owner]: sample.data.value,
    };
  }
}

export async function queryExtensions(
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
) {
  const channel = params.get('channel');
  const result = {
    items: [] as TraceExtensionSample[],
    offset: queryOffset(params),
    total: 0,
  };
  await scan(
    path,
    (line) => {
      if (line.type !== 'extension-sample' || !line.sample) {
        return;
      }
      const sample = line.sample as TraceExtensionSample;
      if (sample.channel !== channel) {
        return;
      }
      if (
        result.total >= result.offset &&
        result.items.length < SESSION_PAGE_SIZE
      ) {
        result.items.push(sample);
      }
      result.total += 1;
    },
    signal,
  );
  return result;
}

function collectMemory(state: Accumulator, line: Line) {
  for (const event of line.events ?? []) {
    addEventMemory(
      state.series,
      event,
      state.recording.duration,
      state.eventOffset,
    );
  }
}
