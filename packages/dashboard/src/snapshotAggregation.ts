import type { CallPathFrame } from './callPaths';
import type { CoreFunctionStat } from './coreAnalysis';
import type { SessionSummary } from './sessionData';
import type {
  FunctionSnapshot,
  StandaloneSnapshot,
} from './standaloneSnapshot';
import type { TraceEvent } from './types';

import { analyzeCoreRecording, functionKey } from './coreAnalysis';
import { oneSecondBuckets, secondIndex } from './lightWindowBuckets';

export interface SnapshotPathNode {
  frame: CallPathFrame;
  parent?: number;
}
type FunctionAccumulator = Omit<FunctionSnapshot, 'pathCounts' | 'paths'> & {
  paths: Map<number, number>;
};
/** Consume each ray once. Only function aggregates and interned stacks survive. */
export class SnapshotAggregation {
  private scopes = new Map<string, Map<string, FunctionAccumulator>>([
    ['', new Map()],
  ]);
  private nodes: SnapshotPathNode[] = [];
  private nodeIds = new Map<string, number>();
  constructor(private summary: SessionSummary) {}

  addRay(events: TraceEvent[], root: string) {
    const byId = new Map(events.map((event) => [event.id, event]));
    const paths = new Map<number, number>();
    for (const event of events) {
      if (event.kind !== 'call') {
        continue;
      }
      const path = this.pathFor(event, byId, paths);
      this.addCall('', event, path);
      if (root) {
        this.addCall(root, event, path);
      }
    }
  }

  finish(): StandaloneSnapshot {
    const base = { ...this.summary.analysis, rays: [] };
    const scopes = [...this.scopes].map(([root, items]) => {
      const functions: FunctionSnapshot[] = [...items.values()].map(
        ({ paths, ...item }) => ({ ...item, pathCounts: [...paths] }),
      );
      const analysis = root ? this.rootAnalysis(functions) : base;
      return { analysis, functions, root };
    });
    if (!scopes[0].functions.length) {
      scopes[0].functions = base.functions.map((stat) => ({
        counts: oneSecondBuckets(this.summary.recording.duration),
        pathCounts: [],
        rootCounts: [],
        stat,
      }));
    }
    return {
      pathNodes: this.nodes,
      scopes,
      summary: {
        ...this.summary,
        analysis: base,
        recording: {
          ...this.summary.recording,
          extensionSamples: this.summary.recording.extensionSamples?.filter(
            (sample) => sample.channel !== 'tracing.ray-metadata',
          ),
          traces: [],
        },
        traceDataExcluded: true,
      },
      version: 1,
    };
  }

  private rootAnalysis(functions: FunctionSnapshot[]) {
    const { analysis, recording } = this.summary;
    const aggregate = analyzeCoreRecording({
      ...recording,
      aggregates: functions.map((item) => item.stat),
      mode: 'light',
      traces: [],
    });
    return {
      ...aggregate,
      activity: sumBuckets(
        functions.map((item) => item.counts),
        recording.duration,
      ),
      blocking: analysis.blocking,
      blockingTotal: analysis.blockingTotal,
      rootActivity: sumBuckets(
        functions.map((item) => item.rootCounts),
        recording.duration,
      ),
      roots: analysis.roots,
      timelineBlocking: analysis.timelineBlocking,
    };
  }

  private pathFor(
    event: TraceEvent,
    byId: Map<number, TraceEvent>,
    cache: Map<number, number>,
  ): number {
    const chain: TraceEvent[] = [];
    const seen = new Set<number>();
    let current: TraceEvent | undefined = event;
    while (
      current &&
      !cache.has(current.id) &&
      !seen.has(current.id) &&
      chain.length < 256
    ) {
      seen.add(current.id);
      chain.push(current);
      current = current.parent == null ? undefined : byId.get(current.parent);
    }
    let parent = current ? cache.get(current.id) : undefined;
    for (const frame of chain.reverse()) {
      parent = this.intern(
        {
          kind: frame.kind,
          name: frame.name,
          namespace: frame.namespace || 'unknown',
        },
        parent,
      );
      cache.set(frame.id, parent);
    }
    return parent!;
  }

  private intern(frame: CallPathFrame, parent?: number): number {
    const key = JSON.stringify([parent, frame]);
    const previous = this.nodeIds.get(key);
    if (previous !== undefined) {
      return previous;
    }
    const id = this.nodes.length;
    this.nodes.push({ frame, parent });
    this.nodeIds.set(key, id);
    return id;
  }

  private addCall(root: string, event: TraceEvent, path: number) {
    let scope = this.scopes.get(root);
    if (!scope) {
      scope = new Map();
      this.scopes.set(root, scope);
    }
    const namespace = event.namespace || 'unknown';
    const key = functionKey(namespace, event.name);
    let item = scope.get(key);
    if (!item) {
      item = createFunction(event, namespace, this.summary.recording.duration);
      scope.set(key, item);
    }
    const duration = event.duration ?? 0;
    item.stat.calls++;
    item.stat.errors += Number(event.status === 'error');
    item.stat.totalDuration += duration;
    item.stat.minDuration = Math.min(item.stat.minDuration, duration);
    item.stat.maxDuration = Math.max(item.stat.maxDuration, duration);
    const bucket = secondIndex(
      event.at,
      item.counts.length,
      this.summary.recording.duration,
    );
    item.counts[bucket]++;
    if (event.parent == null) {
      item.rootCounts[bucket]++;
    }
    item.paths.set(path, (item.paths.get(path) ?? 0) + 1);
  }
}
function createFunction(
  event: TraceEvent,
  namespace: string,
  duration: number,
): FunctionAccumulator {
  const stat: CoreFunctionStat = {
    calls: 0,
    errors: 0,
    maxDuration: 0,
    minDuration: Infinity,
    name: event.name,
    namespace,
    totalDuration: 0,
  };
  return {
    counts: oneSecondBuckets(duration),
    paths: new Map(),
    rootCounts: oneSecondBuckets(duration),
    stat,
  };
}
function sumBuckets(series: number[][], duration: number) {
  const result = oneSecondBuckets(duration);
  for (const counts of series) {
    counts.forEach((count, i) => {
      result[i] += count;
    });
  }
  return result;
}
