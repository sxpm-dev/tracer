import type { BrowserSeries } from './sessionData';
import type { TraceEvent, TraceRecording } from './types';

import { oneSecondBuckets, secondIndex } from './lightWindowBuckets';

export function addRuntimeSample(
  series: Map<string, BrowserSeries>,
  metric: string,
  at: number,
  value: number,
  duration: number,
  unit: BrowserSeries['unit'],
) {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  const item = series.get(metric) ?? {
    count: 0,
    counts: oneSecondBuckets(duration),
    metric,
    points: oneSecondBuckets(duration),
    unit,
  };
  const index = secondIndex(at, item.points.length, duration);
  item.points[index] =
    metric === 'thread.blocking'
      ? item.points[index] + value
      : Math.max(item.points[index], value);
  item.counts[index] += 1;
  item.count += 1;
  series.set(metric, item);
}

export function addEventMemory(
  series: Map<string, BrowserSeries>,
  event: TraceEvent,
  duration: number,
  offset = 0,
) {
  if (event.memory) {
    addRuntimeSample(
      series,
      'memory.js-heap-high-water',
      Math.max(0, event.at - offset),
      event.memory.endBytes,
      duration,
      'bytes',
    );
  }
}

export function legacyRuntimeSeries(
  recording: TraceRecording,
): BrowserSeries[] {
  const series = new Map<string, BrowserSeries>();
  for (const sample of recording.cpuSamples ?? []) {
    addRuntimeSample(
      series,
      'thread.blocking',
      sample.at,
      sample.blockingDuration,
      recording.duration,
      'ms',
    );
  }
  for (const trace of recording.traces) {
    for (const event of trace.events) {
      addEventMemory(series, event, recording.duration);
    }
  }
  return [...series.values()];
}
