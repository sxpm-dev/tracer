import type { DatabaseSync } from 'node:sqlite';

import type { ReportEvidence, ReportFunction } from './performanceReport';
import type { SessionSummary } from './sessionData';
import type { SnapshotProgress } from './snapshotExport';
import type { TraceRecording } from './types';

import {
  durationBucket,
  REPORT_CALCULATION_VERSION,
  reportFunctionKey,
  summarizeBrowserSamples,
} from './performanceReport';

interface EventRow {
  at: number;
  duration: number;
  id: number;
  kind: string;
  name: string;
  namespace: string;
  parent: null | number;
  ray: string;
  status: string;
}
interface FunctionState extends ReportFunction {
  cacheHits: number;
  cacheMisses: number;
}

/** A scalar scan of the existing index. Only one ray is resident at a time. */
export async function exportReportEvidence(
  db: DatabaseSync,
  recording: TraceRecording,
  signal: AbortSignal,
  onProgress?: (progress: SnapshotProgress) => void,
): Promise<ReportEvidence> {
  const total = Number(
    db.prepare('SELECT count(*) AS count FROM events').get()!.count,
  );
  const functions = new Map<string, FunctionState>();
  const markers = new Map<
    string,
    { hits: number; misses: number; name: string; namespace: string }
  >();
  onProgress?.({ completed: 0, total });
  if (fullTrace(recording)) {
    await scanIndexedCalls(db, functions, markers, total, signal, onProgress);
  }
  signal.throwIfAborted();
  onProgress?.({ completed: total, total });
  const browserRows = db
    .prepare(
      'SELECT metric,unit,at,value FROM browser_samples ORDER BY metric,at',
    )
    .all();
  const browser = summarizeBrowserSamples(
    browserRows as unknown as {
      at: number;
      metric: string;
      unit: string;
      value: number;
    }[],
  );
  const cpu = db
    .prepare(
      'SELECT count(*) AS count, sum(blocking) AS blocking FROM cpu_samples',
    )
    .get()!;
  const cache = cacheMetrics(markers);
  const coverageNotes = reportCoverageNotes(
    recording,
    browser.length,
    Number(cpu.count),
  );
  return {
    aggregateFunctions:
      recording.mode === 'light' ? readLightAggregates(db) : undefined,
    blockingCount: Number(cpu.count) || null,
    blockingMs: Number(cpu.count) ? Number(cpu.blocking) : null,
    browser,
    browserCapabilities: recording.browserCapabilities,
    cache: fullTrace(recording) ? cache : null,
    calculationVersion: REPORT_CALCULATION_VERSION,
    coverageNotes,
    droppedBrowserSamples: recording.droppedBrowserSamples,
    droppedFunctionWindows: recording.droppedFunctionWindows,
    durationMs: recording.duration,
    functions: fullTrace(recording)
      ? [...functions.values()].map(
          ({ cacheHits: _hits, cacheMisses: _misses, ...item }) => item,
        )
      : null,
    mode: recording.mode,
    sessionId: recording.sessionId,
    startedAt: recording.startedAt,
    status: recording.status,
    title: recording.title || recording.sessionId,
  };
}

function readLightAggregates(db: DatabaseSync) {
  const stored = db
    .prepare("SELECT value FROM info WHERE key='summary'")
    .get()?.value;
  if (!stored) {
    return [];
  }
  const summary = JSON.parse(String(stored)) as SessionSummary;
  return summary.analysis.functions.map((fn) => ({
    calls: fn.calls,
    errors: fn.errors,
    inclusiveMs: fn.totalDuration,
    name: fn.name,
    namespace: fn.namespace,
  }));
}

function fullTrace(recording: TraceRecording): boolean {
  return recording.mode !== 'browser' && recording.mode !== 'light';
}

function cacheMetrics(
  markers: Map<
    string,
    { hits: number; misses: number; name: string; namespace: string }
  >,
) {
  return [...markers.values()]
    .filter((item) => item.hits + item.misses > 0)
    .map((item) => ({
      // A lone marker type cannot establish complete hit/miss instrumentation.
      hitRate:
        item.hits > 0 && item.misses > 0
          ? item.hits / (item.hits + item.misses)
          : null,
      hits: item.hits,
      key: reportFunctionKey(item.namespace, item.name),
      misses: item.misses,
      name: item.name,
      namespace: item.namespace,
    }));
}

async function scanIndexedCalls(
  db: DatabaseSync,
  functions: Map<string, FunctionState>,
  markers: Map<
    string,
    { hits: number; misses: number; name: string; namespace: string }
  >,
  total: number,
  signal: AbortSignal,
  onProgress?: (progress: SnapshotProgress) => void,
): Promise<void> {
  let ray = '';
  let events: EventRow[] = [];
  let completed = 0;
  const rows = db.prepare(
    'SELECT ray,id,parent,namespace,name,kind,status,at,duration FROM events ORDER BY ray,seq',
  );
  for (const raw of rows.iterate()) {
    const event = raw as unknown as EventRow;
    if (ray && event.ray !== ray) {
      addRay(events, functions, markers);
      events = [];
    }
    ray = event.ray;
    events.push(event);
    completed++;
    if (completed % 10_000 === 0) {
      onProgress?.({ completed, total });
      await new Promise<void>((resolve) => setImmediate(resolve));
      signal.throwIfAborted();
    }
  }
  addRay(events, functions, markers);
}

function reportCoverageNotes(
  recording: TraceRecording,
  browserCount: number,
  cpuCount: number,
): string[] {
  const notes = [
    'Recorded self time subtracts the union of direct-child call intervals, clipped to each parent call. It is elapsed trace time, not CPU usage.',
  ];
  if (recording.mode === 'browser') {
    notes.push(
      'Browser-only capture has no function, root, self-time, or cache measurements.',
    );
  }
  if (recording.mode === 'light') {
    notes.push(
      'Light capture has aggregate function totals but no parent links; root and self-time measurements are unavailable.',
    );
  }
  if (recording.droppedBrowserSamples) {
    notes.push(
      `${recording.droppedBrowserSamples} browser samples were dropped.`,
    );
  }
  if (recording.droppedFunctionWindows) {
    notes.push(
      `${recording.droppedFunctionWindows} function windows were dropped.`,
    );
  }
  if (!browserCount) {
    notes.push('No in-session browser samples are available.');
  }
  if (!cpuCount) {
    notes.push('No long-frame or long-task blocking samples are available.');
  }
  return notes;
}

function functionState(
  event: EventRow,
  functions: Map<string, FunctionState>,
): FunctionState {
  const namespace = event.namespace || 'unknown';
  const key = reportFunctionKey(namespace, event.name);
  let item = functions.get(key);
  if (!item) {
    item = {
      buckets: Array(7).fill(0),
      cacheHits: 0,
      cacheMisses: 0,
      calls: 0,
      errors: 0,
      inclusiveMs: 0,
      key,
      name: event.name,
      namespace,
      rootBuckets: Array(7).fill(0),
      rootCalls: 0,
      rootInclusiveMs: 0,
      rootSelfMs: 0,
      rootTreeCalls: 0,
      selfMs: 0,
    };
    functions.set(key, item);
  }
  return item;
}

function addRay(
  events: EventRow[],
  functions: Map<string, FunctionState>,
  markers: Map<
    string,
    { hits: number; misses: number; name: string; namespace: string }
  >,
): void {
  if (!events.length) {
    return;
  }
  const calls = events.filter((item) => item.kind === 'call');
  const byId = new Map(calls.map((item) => [item.id, item]));
  const children = childIntervals(calls, byId);
  const roots = new Map<number, EventRow>();
  const rootFor = (event: EventRow): EventRow => {
    const cached = roots.get(event.id);
    if (cached) {
      return cached;
    }
    const parent = event.parent === null ? undefined : byId.get(event.parent);
    // Parent links normally precede children. A missing parent bounds the
    // observed tree; it does not make this call a recorded root.
    const root = !parent || parent.id === event.id ? event : rootFor(parent);
    roots.set(event.id, root);
    return root;
  };
  for (const event of calls) {
    addCall(event, children, rootFor(event), functions);
  }
  for (const event of events) {
    addMarker(event, markers);
  }
}

function childIntervals(calls: EventRow[], byId: Map<number, EventRow>) {
  const children = new Map<number, { end: number; start: number }[]>();
  for (const event of calls) {
    if (event.parent === null || !byId.has(event.parent)) {
      continue;
    }
    const intervals = children.get(event.parent) ?? [];
    intervals.push({
      end: event.at + Math.max(0, event.duration),
      start: event.at,
    });
    children.set(event.parent, intervals);
  }
  return children;
}

function addCall(
  event: EventRow,
  children: Map<number, { end: number; start: number }[]>,
  root: EventRow,
  functions: Map<string, FunctionState>,
): void {
  const stat = functionState(event, functions);
  const inclusive = Math.max(0, event.duration);
  const self = Math.max(
    0,
    inclusive -
      intervalUnion(
        children.get(event.id) ?? [],
        event.at,
        event.at + inclusive,
      ),
  );
  stat.calls++;
  stat.inclusiveMs += inclusive;
  stat.selfMs += self;
  stat.errors += Number(event.status === 'error');
  stat.buckets[durationBucket(inclusive)]++;
  functionState(root, functions).rootTreeCalls++;
  if (event.parent === null) {
    stat.rootCalls++;
    stat.rootInclusiveMs += inclusive;
    stat.rootSelfMs += self;
    stat.rootBuckets[durationBucket(inclusive)]++;
  }
}

function addMarker(
  event: EventRow,
  markers: Map<
    string,
    { hits: number; misses: number; name: string; namespace: string }
  >,
): void {
  if (event.kind !== 'marker') {
    return;
  }
  const match = /^(.*)\.cache-(hit|miss)$/.exec(event.name);
  if (!match) {
    return;
  }
  const key = reportFunctionKey(event.namespace, match[1]);
  const marker = markers.get(key) ?? {
    hits: 0,
    misses: 0,
    name: match[1],
    namespace: event.namespace,
  };
  if (match[2] === 'hit') {
    marker.hits++;
  } else {
    marker.misses++;
  }
  markers.set(key, marker);
}

export function intervalUnion(
  intervals: { end: number; start: number }[],
  lower: number,
  upper: number,
): number {
  const sorted = intervals
    .map(({ end, start }) => ({
      end: Math.min(upper, end),
      start: Math.max(lower, start),
    }))
    .filter(({ end, start }) => end > start)
    .sort((a, b) => a.start - b.start);
  let covered = 0;
  let cursor = lower;
  for (const { end, start } of sorted) {
    covered += Math.max(0, end - Math.max(cursor, start));
    cursor = Math.max(cursor, end);
  }
  return covered;
}
