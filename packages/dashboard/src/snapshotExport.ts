import type { DatabaseSync } from 'node:sqlite';

import type { SessionSummary } from './sessionData';
import type { TraceEvent } from './types';

import { SnapshotAggregation } from './snapshotAggregation';

export interface SnapshotProgress {
  completed: number;
  total: number;
}
/** One scalar-only scan, independent of the number of functions and roots. */
export async function exportIndexedSnapshot(
  db: DatabaseSync,
  summary: SessionSummary,
  signal: AbortSignal,
  onProgress?: (progress: SnapshotProgress) => void,
) {
  const total = Number(
    db.prepare('SELECT count(*) AS total FROM events').get()!.total,
  );
  const aggregation = new SnapshotAggregation(summary);
  const rows =
    db.prepare(`SELECT e.ray,e.id,e.parent,e.namespace,e.name,e.kind,e.status,e.at,e.duration,r.name AS root
    FROM events e LEFT JOIN rays r ON r.ray=e.ray ORDER BY e.ray,e.seq`);
  let events: TraceEvent[] = [];
  let ray: string | undefined;
  let root = '';
  let completed = 0;
  onProgress?.({ completed, total });
  for (const row of rows.iterate()) {
    if (row.ray !== ray) {
      aggregation.addRay(events, root);
      events = [];
      ray = String(row.ray);
      root = String(row.root ?? '');
    }
    events.push(row as unknown as TraceEvent);
    completed++;
    if (completed % 10_000 === 0) {
      onProgress?.({ completed, total });
      await new Promise((resolve) => setTimeout(resolve, 0));
      signal.throwIfAborted();
    }
  }
  signal.throwIfAborted();
  aggregation.addRay(events, root);
  onProgress?.({ completed, total });
  return aggregation.finish();
}
