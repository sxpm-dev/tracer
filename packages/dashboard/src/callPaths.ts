import type { TraceEvent } from './types';

export interface CallPathFrame {
  kind: TraceEvent['kind'];
  name: string;
  namespace: string;
}

export interface CallPath {
  calls: number;
  frames: CallPathFrame[];
}

export function addCallPath(
  paths: Map<string, CallPath>,
  frames: CallPathFrame[],
) {
  const key = JSON.stringify(frames);
  const existing = paths.get(key);
  if (existing) {
    existing.calls++;
  } else {
    paths.set(key, { calls: 1, frames });
  }
}

export function sortedCallPaths(paths: Map<string, CallPath>): CallPath[] {
  return [...paths.values()].sort(
    (a, b) =>
      b.calls - a.calls ||
      JSON.stringify(a.frames).localeCompare(JSON.stringify(b.frames)),
  );
}
