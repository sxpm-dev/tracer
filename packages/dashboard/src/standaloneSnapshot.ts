import type { CallPath } from './callPaths';
import type { CoreAnalysis, CoreFunctionStat } from './coreAnalysis';
import type { DashboardViewState } from './navigation';
import type {
  CallAnalytics,
  FrameQuery,
  SessionClient,
  SessionSummary,
} from './sessionData';
import type { TraceRecording } from './types';

import { seriesFor } from './CoreBrowserSignals';
import { createLocalSessionClient } from './localSessionClient';
import { namespaceMatches } from './namespaceSelection';
import {
  SnapshotAggregation,
  type SnapshotPathNode,
} from './snapshotAggregation';

export interface FunctionSnapshot {
  counts: number[];
  pathCounts?: [number, number][];
  paths?: CallPath[];
  rootCounts: number[];
  stat: CoreFunctionStat;
}
interface SnapshotScope {
  analysis: CoreAnalysis;
  functions: FunctionSnapshot[];
  root: string;
}
/** A dashboard projection, never a complete recording or a collection of frames. */
export interface StandaloneSnapshot {
  extensions?: Record<string, unknown>;
  pathNodes?: SnapshotPathNode[];
  scopes: SnapshotScope[];
  summary: SessionSummary;
  theme?: string;
  version: 1;
  view?: DashboardViewState;
}
export interface SnapshotOptions {
  client?: SessionClient;
  extensions?: Record<string, unknown>;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  summary?: SessionSummary;
  view?: DashboardViewState;
}
export async function createStandaloneSnapshot(
  recording: TraceRecording,
  options: SnapshotOptions = {},
): Promise<StandaloneSnapshot> {
  options.signal?.throwIfAborted();
  if (options.client) {
    if (!options.client.exportSnapshot) {
      throw new Error(
        'The dashboard server must be updated to support bulk export.',
      );
    }
    const snapshot = await options.client.exportSnapshot(
      recording.sessionId,
      options.signal,
      options.onProgress,
    );
    return {
      ...snapshot,
      extensions: options.extensions,
      theme: snapshotTheme(),
      view: snapshotView(options.view),
    };
  }
  return createLocalSnapshot(recording, options);
}
async function createLocalSnapshot(
  recording: TraceRecording,
  options: SnapshotOptions,
) {
  const client = createLocalSessionClient(recording);
  const summary =
    options.summary ??
    (await client.summary(recording.sessionId, '', options.signal));
  const aggregation = new SnapshotAggregation({
    ...summary,
    browser: { ...summary.browser, series: seriesFor(recording) },
  });
  let completed = 0;
  for (const trace of recording.traces) {
    options.signal?.throwIfAborted();
    const root = trace.events.find((event) => event.kind === 'call');
    aggregation.addRay(
      trace.events,
      root ? `${root.namespace || 'unknown'}.${root.name}` : '',
    );
    completed++;
    if (completed % 100 === 0) {
      options.onProgress?.(completed / recording.traces.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  options.signal?.throwIfAborted();
  options.onProgress?.(1);
  return {
    ...aggregation.finish(),
    extensions: options.extensions,
    theme: snapshotTheme(),
    view: snapshotView(options.view),
  };
}
export function snapshotTheme() {
  return typeof document === 'undefined'
    ? undefined
    : (document.querySelector('[data-theme]')?.getAttribute('data-theme') ??
        undefined);
}
export function snapshotSummary(snapshot?: StandaloneSnapshot) {
  return snapshot?.summary;
}
export function snapshotView(
  view: DashboardViewState = { page: 'overview' },
): DashboardViewState {
  return {
    functionId: view.functionId,
    namespace: view.namespace,
    page: view.page === 'frames' ? 'functions' : view.page,
    query: view.frameQuery ?? view.query,
    root: view.root,
  };
}
export function readStandaloneSnapshot(): StandaloneSnapshot | undefined {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const source = document.getElementById('dashboard-snapshot')?.textContent;
  return source ? (JSON.parse(source) as StandaloneSnapshot) : undefined;
}
function matches(stat: CoreFunctionStat, query: FrameQuery) {
  return (
    namespaceMatches(query.namespace, stat.namespace) &&
    (!query.name || stat.name === query.name) &&
    `${stat.namespace}.${stat.name}`
      .toLowerCase()
      .includes((query.query ?? '').toLowerCase())
  );
}
function addCounts(items: number[][], length: number): number[] {
  const result = Array<number>(length).fill(0);
  for (const counts of items) {
    counts.forEach((count, index) => {
      result[index] += count;
    });
  }
  return result;
}
export function createSnapshotClient(
  snapshot: StandaloneSnapshot,
): SessionClient {
  const local = createLocalSessionClient(snapshot.summary.recording);
  const scopeFor = (root = '') => {
    const scope = snapshot.scopes.find((item) => item.root === root);
    if (!scope) {
      throw new Error('This root is unavailable in the exported dashboard.');
    }
    return scope;
  };
  return {
    ...local,
    async analytics(_id, query, signal): Promise<CallAnalytics> {
      signal?.throwIfAborted();
      assertSummaryQuery(query);
      const scope = scopeFor(query.root);
      const items = scope.functions.filter((item) => matches(item.stat, query));
      const counts = addCounts(
        items.map((item) => item.counts),
        scope.analysis.activity.length,
      );
      const rootCounts = addCounts(
        items.map((item) => item.rootCounts),
        counts.length,
      );
      return {
        bucketMs: 1000,
        chartCounts: counts,
        chartRootCounts: rootCounts,
        counts,
        functions: items.map((item) => item.stat),
        rootTotal: rootCounts.reduce((sum, count) => sum + count, 0),
        total: items.reduce((sum, item) => sum + item.stat.calls, 0),
      };
    },
    async callPaths(_id, query, signal) {
      signal?.throwIfAborted();
      assertSummaryQuery(query);
      return scopeFor(query.root)
        .functions.filter((item) => matches(item.stat, query))
        .flatMap((item) => resolvePaths(snapshot, item));
    },
    async summary(_id, root, signal) {
      signal?.throwIfAborted();
      return { ...snapshot.summary, analysis: scopeFor(root).analysis };
    },
  };
}

function assertSummaryQuery(query: FrameQuery) {
  const fields = [
    'from',
    'to',
    'minDuration',
    'maxDuration',
    'parent',
    'ray',
    'subtree',
  ] as const;
  if (
    fields.some((key) => query[key] !== undefined) ||
    query.rootsOnly ||
    query.kind === 'error'
  ) {
    throw new Error(
      'This filter requires individual calls, which are excluded from the exported dashboard.',
    );
  }
}

function resolvePaths(
  snapshot: StandaloneSnapshot,
  item: FunctionSnapshot,
): CallPath[] {
  if (item.paths) {
    return item.paths;
  }
  return (item.pathCounts ?? [])
    .map(([id, calls]) => {
      const frames: CallPath['frames'] = [];
      let current: number | undefined = id;
      while (current !== undefined && frames.length < 256) {
        const node: SnapshotPathNode | undefined =
          snapshot.pathNodes?.[current];
        if (!node) {
          break;
        }
        frames.unshift(node.frame);
        current = node.parent;
      }
      return { calls, frames };
    })
    .sort((a, b) => b.calls - a.calls);
}
