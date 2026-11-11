import type { TraceRecording } from './types';

/** Older captures used performance.now() for events but relative time for samples. */
export function legacyEventOffset(
  recording: TraceRecording,
  minimum: number,
  maximum: number,
): number {
  const origin = recording.timelineOrigin ?? 0;
  return origin > 0 &&
    minimum >= origin &&
    maximum > recording.duration &&
    maximum <= origin + recording.duration + 1000
    ? origin
    : 0;
}
export function normalizeRecordingTimeline(recording: TraceRecording) {
  let minimum = Infinity;
  let maximum = 0;
  for (const trace of recording.traces) {
    for (const event of trace.events) {
      minimum = Math.min(minimum, event.at);
      maximum = Math.max(maximum, event.at);
    }
  }
  const offset = legacyEventOffset(recording, minimum, maximum);
  if (offset) {
    for (const trace of recording.traces) {
      for (const event of trace.events) {
        event.at = Math.max(0, event.at - offset);
      }
    }
  }
  return recording;
}
