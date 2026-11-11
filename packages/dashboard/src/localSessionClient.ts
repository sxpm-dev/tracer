import type { TraceEvent, TraceRecording } from './types';

import {
  addCallPath,
  type CallPath,
  type CallPathFrame,
  sortedCallPaths,
} from './callPaths';
import { analyzeCoreRecording } from './coreAnalysis';
import {
  bucketWidth,
  oneSecondBuckets,
  secondIndex,
} from './lightWindowBuckets';
import { namespaceMatches } from './namespaceSelection';
import {
  type FrameQuery,
  SESSION_PAGE_SIZE,
  type SessionClient,
} from './sessionData';

/** Imported files share the same explorer UX while retaining their local data. */
export function createLocalSessionClient(
  recording: TraceRecording,
): SessionClient {
  const analysis = analyzeCoreRecording(recording);
  const roots = new Map(analysis.rays.map((ray) => [ray.ray, ray.name]));
  return {
    async analytics(_id, query, signal) {
      signal?.throwIfAborted();
      const traces = recording.traces
        .map((trace) => ({
          ...trace,
          events: trace.events.filter((event) => matches(event, query)),
        }))
        .filter(
          (trace) =>
            (!query.ray || trace.ray === query.ray) &&
            (!query.root || roots.get(trace.ray) === query.root),
        );
      const functions = analyzeCoreRecording({
        ...recording,
        traces,
      }).functions;
      const visibleFunctions = query.functionLimit
        ? [...functions]
            .sort((left, right) => right.totalDuration - left.totalDuration)
            .slice(0, query.functionLimit)
        : functions;
      const bucketMs = bucketWidth(recording.duration);
      const counts = oneSecondBuckets(recording.duration);
      const chartRootCounts = oneSecondBuckets(recording.duration);
      for (const trace of traces) {
        for (const event of trace.events) {
          if (event.kind === 'call') {
            const chartBucket = secondIndex(
              event.at,
              counts.length,
              recording.duration,
            );
            counts[chartBucket]++;
            if (event.parent === undefined || event.parent === null) {
              chartRootCounts[chartBucket]++;
            }
          }
        }
      }
      return {
        bucketMs,
        chartCounts: counts,
        chartRootCounts,
        counts,
        functions: visibleFunctions,
        rootTotal: chartRootCounts.reduce((a, b) => a + b, 0),
        total: counts.reduce((a, b) => a + b, 0),
      };
    },
    async callPaths(_id, query, signal) {
      signal?.throwIfAborted();
      return localCallPaths(recording, roots, query);
    },
    async frames(_id, query, signal) {
      if (query.subtree !== undefined) {
        return localSubtree(recording, query);
      }
      signal?.throwIfAborted();
      const rows: TraceEvent[] = [];
      for (const trace of recording.traces) {
        if (differentRay(query, trace.ray)) {
          continue;
        }
        if (query.root && roots.get(trace.ray) !== query.root) {
          continue;
        }
        for (const event of trace.events) {
          if (matches(event, query)) {
            rows.push({
              ...event,
              childCount: trace.events.filter(
                (child) => child.parent === event.id,
              ).length,
            } as TraceEvent);
          }
        }
      }
      sortRows(rows, query.sort);
      return {
        ...page(rows, query.offset ?? 0),
        ...frameSelection(recording, query),
      };
    },
    async progress() {
      return { bytes: 0, phase: 'Ready', totalBytes: 0 };
    },
    async rays(_id, offset = 0, query = '', signal) {
      signal?.throwIfAborted();
      const items = analysis.rays.filter((ray) =>
        `${ray.name} ${ray.ray}`.toLowerCase().includes(query.toLowerCase()),
      );
      return page(items, offset);
    },
    async samples(_id, channel, offset = 0, signal) {
      signal?.throwIfAborted();
      return page(
        (recording.extensionSamples ?? []).filter(
          (sample) => sample.channel === channel,
        ),
        offset,
      );
    },
    async summary(_id, root = '', signal) {
      signal?.throwIfAborted();
      return {
        analysis: root ? analyzeCoreRecording(recording, root) : analysis,
        browser: { functions: [], series: [] },
        recording,
      };
    },
  };
}
function localCallPaths(
  recording: TraceRecording,
  roots: Map<string, string>,
  query: FrameQuery,
): CallPath[] {
  if (!query.name) {
    return [];
  }
  const paths = new Map<string, CallPath>();
  for (const trace of recording.traces) {
    if (
      differentRay(query, trace.ray) ||
      (query.root && roots.get(trace.ray) !== query.root)
    ) {
      continue;
    }
    const byId = new Map(trace.events.map((event) => [event.id, event]));
    for (const event of trace.events) {
      if (event.kind === 'call' && matches(event, query)) {
        addCallPath(paths, localEventPath(event, byId));
      }
    }
  }
  return sortedCallPaths(paths);
}
function localEventPath(
  event: TraceEvent,
  byId: Map<number, TraceEvent>,
): CallPathFrame[] {
  const frames: CallPathFrame[] = [];
  const seen = new Set<number>();
  let current: TraceEvent | undefined = event;
  while (current && !seen.has(current.id) && frames.length < 256) {
    seen.add(current.id);
    frames.unshift({
      kind: current.kind,
      name: current.name,
      namespace: current.namespace || 'unknown',
    });
    current = current.parent == null ? undefined : byId.get(current.parent);
  }
  return frames;
}
function page<T>(items: T[], offset: number) {
  return {
    items: items.slice(offset, offset + SESSION_PAGE_SIZE),
    offset,
    total: items.length,
  };
}
function matches(event: TraceEvent, query: FrameQuery) {
  const fields =
    namespaceMatches(query.namespace, event.namespace) &&
    (!query.name || event.name === query.name) &&
    `${event.namespace}.${event.name}`
      .toLowerCase()
      .includes((query.query ?? '').toLowerCase());
  return (
    (!query.rootsOnly || event.parent == null) &&
    fields &&
    matchesKind(event, query.kind) &&
    matchesRange(event, query)
  );
}
function matchesKind(event: TraceEvent, kind?: string) {
  if (kind === 'error') {
    return event.status === 'error';
  }
  return !kind || event.kind === kind;
}
function matchesRange(event: TraceEvent, query: FrameQuery) {
  return (
    durationMatches(event, query) &&
    event.at >= (query.from ?? 0) &&
    event.at < (query.to ?? Infinity) &&
    (query.parent === undefined || event.parent === query.parent)
  );
}
function sortRows(rows: TraceEvent[], sort?: string) {
  const compare: Record<string, (a: TraceEvent, b: TraceEvent) => number> = {
    duration: (a, b) => (b.duration ?? 0) - (a.duration ?? 0),
    'duration-asc': (a, b) => (a.duration ?? 0) - (b.duration ?? 0),
    time: (a, b) => a.at - b.at,
    'time-desc': (a, b) => b.at - a.at,
  };
  if (sort && compare[sort]) {
    rows.sort(compare[sort]);
  }
}

function frameSelection(recording: TraceRecording, query: FrameQuery) {
  const trace = recording.traces.find(
    (item) => item.ray === (query.frameRay ?? query.ray),
  );
  return {
    metadata: trace?.metadata,
    selected: trace?.events.find((event) => event.id === query.frame),
  };
}

function durationMatches(event: TraceEvent, query: FrameQuery) {
  const duration = event.duration ?? 0;
  return (
    duration >= (query.minDuration ?? 0) &&
    duration <= (query.maxDuration ?? Infinity)
  );
}

function localSubtree(recording: TraceRecording, query: FrameQuery) {
  const trace = recording.traces.find((item) => item.ray === query.ray);
  const root = subtreeRoot(trace, query.subtree);
  const rows: import('./sessionData').FrameItem[] = [];
  const children = new Map<number, TraceEvent[]>();
  for (const event of trace?.events ?? []) {
    if (event.parent !== undefined) {
      children.set(event.parent, [
        ...(children.get(event.parent) ?? []),
        event,
      ]);
    }
  }
  const visit = (
    id: number,
    depth: number,
    ancestors: { id: number; name: string }[],
  ) => {
    if (depth > 256) {
      return;
    }
    for (const event of children.get(id) ?? []) {
      if (ancestors.some((ancestor) => ancestor.id === event.id)) {
        continue;
      }
      rows.push({
        ...event,
        ancestors,
        childCount: children.get(event.id)?.length ?? 0,
        depth,
      });
      visit(event.id, depth + 1, [
        ...ancestors,
        { id: event.id, name: event.name },
      ]);
    }
  };
  if (root) {
    rows.push({
      ...root,
      ancestors: [],
      childCount: children.get(root.id)?.length ?? 0,
      depth: 0,
    });
    visit(root.id, 1, [{ id: root.id, name: root.name }]);
  }
  return {
    ...page(
      rows.filter((event) => subtreeMatches(event, root?.id, query)),
      query.offset ?? 0,
    ),
    ...frameSelection(recording, query),
  };
}

function subtreeRoot(
  trace: TraceRecording['traces'][number] | undefined,
  id: number | undefined,
) {
  return trace?.events.find((event) => event.id === id);
}

function subtreeMatches(
  event: TraceEvent,
  rootId: number | undefined,
  query: FrameQuery,
) {
  return (
    event.id === rootId ||
    matches(event, { ...query, parent: undefined, rootsOnly: false })
  );
}

function differentRay(query: FrameQuery, ray: string) {
  return query.ray && ray !== query.ray;
}
