import type {
  TraceEvent,
  TraceFunctionAggregate,
  TraceRecording,
} from './types';

import {
  distributeLightWindowBySecond,
  lightWindowCrossesSecond,
  oneSecondBuckets,
  secondIndex,
} from './lightWindowBuckets';

export const TIMELINE_BUCKETS = 48;

export interface CoreFunctionStat {
  calls: number;
  errors: number;
  maxDuration: number;
  minDuration: number;
  name: string;
  namespace: string;
  totalDuration: number;
}

export interface CoreRoot {
  calls: number;
  key: string;
  rays: number;
}

export interface CoreRay {
  calls: number;
  duration: number;
  errors: number;
  name: string;
  ray: string;
  startedAt: number;
}

export interface CoreFinding {
  description: string;
  functionKey?: string;
  id: string;
  metric: string;
  severity: 'critical' | 'notice' | 'warning';
  title: string;
}

export interface CoreAnalysis {
  activity: number[];
  activityEstimated?: boolean;
  blocking: number[];
  blockingTotal: number;
  calls: number;
  errors: number;
  findings: CoreFinding[];
  functions: CoreFunctionStat[];
  rays: CoreRay[];
  rootActivity?: number[];
  roots: CoreRoot[];
  timelineBlocking: number[];
}

interface AnalysisAccumulator {
  activity: number[];
  calls: number;
  errors: number;
  functions: Map<string, CoreFunctionStat>;
  rays: CoreRay[];
  rootActivity: number[];
  roots: Map<string, CoreRoot>;
}

export function functionKey(namespace: string, name: string): string {
  return `${namespace}\u0000${name}`;
}

export function analyzeCoreRecording(
  recording: TraceRecording,
  selectedRoot = '',
): CoreAnalysis {
  const result: AnalysisAccumulator = {
    activity: oneSecondBuckets(recording.duration),
    calls: 0,
    errors: 0,
    functions: new Map(),
    rays: [],
    rootActivity: oneSecondBuckets(recording.duration),
    roots: new Map(),
  };
  const blocking = emptyBuckets();
  const timelineBlocking = oneSecondBuckets(recording.duration);
  let activityEstimated = false;
  if (recording.mode === 'light') {
    activityEstimated = collectLightActivity(result, recording);
  } else {
    collectTraces(result, recording, selectedRoot);
  }
  for (const sample of recording.cpuSamples ?? []) {
    blocking[bucketIndex(sample.at, recording.duration)] +=
      sample.blockingDuration;
    timelineBlocking[
      secondIndex(sample.at, timelineBlocking.length, recording.duration)
    ] += sample.blockingDuration;
  }
  const sortedFunctions = [...result.functions.values()].sort(
    (left, right) => right.totalDuration - left.totalDuration,
  );
  const blockingTotal = blocking.reduce((total, value) => total + value, 0);
  return {
    activity: result.activity,
    activityEstimated,
    blocking,
    blockingTotal,
    calls: result.calls,
    errors: result.errors,
    findings: detectCoreFindings(sortedFunctions, recording.cpuSamples ?? []),
    functions: sortedFunctions,
    rays: result.rays.sort((left, right) => left.startedAt - right.startedAt),
    rootActivity: recording.mode === 'light' ? undefined : result.rootActivity,
    roots: [...result.roots.values()].sort(
      (left, right) => right.calls - left.calls,
    ),
    timelineBlocking,
  };
}

function collectLightActivity(
  result: AnalysisAccumulator,
  recording: TraceRecording,
): boolean {
  collectAggregates(result, recording.aggregates ?? []);
  let windowCalls = 0;
  let activityEstimated = false;
  for (const window of recording.functionWindows ?? []) {
    const calls =
      window.functions.reduce((total, item) => total + item.calls, 0) +
      window.otherCalls;
    windowCalls += calls;
    activityEstimated ||= lightWindowCrossesSecond(window, recording.duration);
    distributeLightWindowBySecond(
      window,
      recording.duration,
      (index, share) => {
        result.activity[index] += calls * share;
      },
    );
  }
  return (
    activityEstimated ||
    windowCalls !== result.calls ||
    Boolean(recording.droppedFunctionWindows)
  );
}

function collectAggregates(
  result: AnalysisAccumulator,
  aggregates: TraceFunctionAggregate[],
): void {
  for (const aggregate of aggregates) {
    addAggregate(result.functions, aggregate);
    result.calls += aggregate.calls;
    result.errors += aggregate.errors;
  }
}

function collectTraces(
  result: AnalysisAccumulator,
  recording: TraceRecording,
  selectedRoot: string,
): void {
  for (const trace of recording.traces) {
    const root = trace.events.find((event) => event.kind === 'call');
    const rootKey = root ? `${root.namespace || 'unknown'}.${root.name}` : '';
    addRay(result, trace.ray, trace.events, rootKey);
    if (selectedRoot && selectedRoot !== rootKey) {
      continue;
    }
    for (const event of trace.events) {
      if (event.kind !== 'call') {
        continue;
      }
      addEvent(result.functions, event);
      result.calls += 1;
      result.errors += Number(event.status === 'error');
      const second = secondIndex(
        event.at,
        result.activity.length,
        recording.duration,
      );
      result.activity[second] += 1;
      if (event.parent == null) {
        result.rootActivity[second] += 1;
      }
    }
  }
}

function addRay(
  result: AnalysisAccumulator,
  rayId: string,
  events: TraceEvent[],
  rootKey: string,
): void {
  const ray = summarizeRay(rayId, events, rootKey);
  if (!ray || !rootKey) {
    return;
  }
  result.rays.push(ray);
  const root = result.roots.get(rootKey) ?? { calls: 0, key: rootKey, rays: 0 };
  root.calls += ray.calls;
  root.rays += 1;
  result.roots.set(rootKey, root);
}

function emptyBuckets(): number[] {
  return Array.from({ length: TIMELINE_BUCKETS }, () => 0);
}

function bucketIndex(at: number, duration: number): number {
  return Math.min(
    TIMELINE_BUCKETS - 1,
    Math.max(0, Math.floor((at / Math.max(duration, 1)) * TIMELINE_BUCKETS)),
  );
}

function addAggregate(
  functions: Map<string, CoreFunctionStat>,
  aggregate: TraceFunctionAggregate,
): void {
  functions.set(functionKey(aggregate.namespace, aggregate.name), {
    calls: aggregate.calls,
    errors: aggregate.errors,
    maxDuration: aggregate.maxDuration,
    minDuration: aggregate.minDuration,
    name: aggregate.name,
    namespace: aggregate.namespace,
    totalDuration: aggregate.totalDuration,
  });
}

function addEvent(
  functions: Map<string, CoreFunctionStat>,
  event: TraceEvent,
): void {
  const namespace = event.namespace || 'unknown';
  const key = functionKey(namespace, event.name);
  const item = functions.get(key) ?? {
    calls: 0,
    errors: 0,
    maxDuration: 0,
    minDuration: Number.POSITIVE_INFINITY,
    name: event.name,
    namespace,
    totalDuration: 0,
  };
  const duration = event.duration ?? 0;
  item.calls += 1;
  item.errors += Number(event.status === 'error');
  item.maxDuration = Math.max(item.maxDuration, duration);
  item.minDuration = Math.min(item.minDuration, duration);
  item.totalDuration += duration;
  functions.set(key, item);
}

function summarizeRay(
  ray: string,
  events: TraceEvent[],
  name: string,
): CoreRay | undefined {
  let startedAt = Number.POSITIVE_INFINITY;
  let endedAt = 0;
  let calls = 0;
  let errors = 0;
  for (const event of events) {
    if (event.kind !== 'call') {
      continue;
    }
    calls += 1;
    errors += Number(event.status === 'error');
    startedAt = Math.min(startedAt, event.at);
    endedAt = Math.max(endedAt, event.at + (event.duration ?? 0));
  }
  return calls
    ? { calls, duration: endedAt - startedAt, errors, name, ray, startedAt }
    : undefined;
}

function detectCoreFindings(
  functions: CoreFunctionStat[],
  cpuSamples: NonNullable<TraceRecording['cpuSamples']>,
): CoreFinding[] {
  const findings: CoreFinding[] = [];
  for (const item of functions.filter(({ errors }) => errors > 0).slice(0, 5)) {
    findings.push({
      description: `${item.errors.toLocaleString()} of ${item.calls.toLocaleString()} calls failed. Inspect the function and its trace frames.`,
      functionKey: functionKey(item.namespace, item.name),
      id: `errors:${item.namespace}:${item.name}`,
      metric: `${item.errors.toLocaleString()} errors`,
      severity: 'critical',
      title: `${item.name} returned errors`,
    });
  }
  for (const item of functions
    .filter(({ maxDuration }) => maxDuration >= 100)
    .sort((left, right) => right.maxDuration - left.maxDuration)
    .slice(0, 5)) {
    findings.push({
      description: `The slowest observed call took ${Math.round(item.maxDuration)} ms. Compare it with other calls to the same function.`,
      functionKey: functionKey(item.namespace, item.name),
      id: `slow:${item.namespace}:${item.name}`,
      metric: `${Math.round(item.maxDuration)} ms max`,
      severity: 'warning',
      title: `${item.name} has a slow call`,
    });
  }
  const longestBlock = cpuSamples.reduce(
    (longest, sample) => Math.max(longest, sample.blockingDuration),
    0,
  );
  if (longestBlock >= 50) {
    findings.push({
      description:
        'The browser reported a main-thread blocking interval. Use the timeline to inspect calls nearby; timing alone does not prove causation.',
      id: 'main-thread-blocking',
      metric: `${Math.round(longestBlock)} ms max`,
      severity: 'warning',
      title: 'Main thread was blocked',
    });
  }
  return findings;
}
