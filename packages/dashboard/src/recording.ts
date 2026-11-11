import type {
  EventRow,
  LocalRecordingSummary,
  TraceBrowserSample,
  TraceCpuSample,
  TraceEvent,
  TraceExtensionSample,
  TraceFunctionAggregate,
  TraceFunctionWindow,
  TraceRecording,
} from './types';

import { normalizeRecordingTimeline } from './timeline';

export function parseRecording(value: string): TraceRecording {
  const parsed: unknown = JSON.parse(value);
  if (!isRecording(parsed)) {
    throw new Error('This does not look like a trace recording.');
  }
  return withRayMetadata(parsed);
}

export function parseRecordingJsonl(value: string): TraceRecording {
  const state = createJsonlRecordingState();
  for (const source of value.split(/\r?\n/)) {
    if (!source.trim()) {
      continue;
    }
    consumeRecordingLine(state, JSON.parse(source) as JsonlRecordingLine);
  }
  return finishJsonlRecording(state);
}

export async function parseRecordingJsonlStream(
  stream: ReadableStream<Uint8Array>,
  onProgress?: (loadedBytes: number) => void,
): Promise<TraceRecording> {
  const state = createJsonlRecordingState();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let loadedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    loadedBytes += value.byteLength;
    buffered += decoder.decode(value, { stream: true });
    buffered = consumeCompleteLines(state, buffered);
    onProgress?.(loadedBytes);
  }
  buffered += decoder.decode();
  if (buffered.trim()) {
    consumeRecordingLine(state, JSON.parse(buffered) as JsonlRecordingLine);
  }
  return finishJsonlRecording(state);
}

function createJsonlRecordingState(): JsonlRecordingState {
  return {
    aggregates: [],
    browserSamples: [],
    cpuSamples: [],
    extensionSamples: [],
    functionWindows: [],
    traces: new Map(),
  };
}

function consumeCompleteLines(
  state: JsonlRecordingState,
  value: string,
): string {
  let start = 0;
  let newline = value.indexOf('\n');
  while (newline !== -1) {
    const line = value.slice(start, newline).trim();
    if (line) {
      consumeRecordingLine(state, JSON.parse(line) as JsonlRecordingLine);
    }
    start = newline + 1;
    newline = value.indexOf('\n', start);
  }
  return value.slice(start);
}

function finishJsonlRecording(state: JsonlRecordingState): TraceRecording {
  if (!state.metadata) {
    throw new Error('The saved session metadata is missing.');
  }
  return withRayMetadata({
    aggregates: state.aggregates,
    browserCapabilities: state.metadata.browserCapabilities,
    browserSamples: state.browserSamples,
    cpuSamples: state.cpuSamples,
    cpuSource: state.metadata.cpuSource,
    droppedBrowserSamples: state.metadata.droppedBrowserSamples,
    droppedFunctionWindows: state.metadata.droppedFunctionWindows,
    duration: state.metadata.duration ?? 0,
    extensionSamples: state.extensionSamples,
    functionWindows: state.functionWindows,
    mode: state.metadata.mode,
    releasedAt: state.metadata.releasedAt ?? state.metadata.updatedAt,
    schemaVersion: 1,
    sessionId: state.metadata.sessionId,
    startedAt: state.metadata.startedAt,
    status: state.metadata.status,
    timelineOrigin: state.metadata.timelineOrigin,
    title: state.metadata.title,
    traces: [...state.traces].map(([ray, events]) => ({ events, ray })),
  });
}

export function withRayMetadata(recording: TraceRecording): TraceRecording {
  const byRay = new Map(recording.traces.map((ray) => [ray.ray, ray]));
  for (const sample of recording.extensionSamples ?? []) {
    if (sample.channel !== 'tracing.ray-metadata') {
      continue;
    }
    const data = sample.data as null | {
      owner?: string;
      ray?: string;
      value?: unknown;
    };
    if (
      !data ||
      typeof data.ray !== 'string' ||
      typeof data.owner !== 'string'
    ) {
      continue;
    }
    const ray = byRay.get(data.ray);
    if (!ray) {
      continue;
    }
    ray.metadata = { ...ray.metadata, [data.owner]: data.value };
  }
  return normalizeRecordingTimeline(recording);
}

type JsonlRecordingLine = Partial<LocalRecordingSummary> & {
  aggregate?: TraceFunctionAggregate;
  events?: TraceEvent[];
  ray?: string;
  sample?: TraceBrowserSample | TraceCpuSample | TraceExtensionSample;
  type?: string;
  window?: TraceFunctionWindow;
};

interface JsonlRecordingState {
  aggregates: TraceFunctionAggregate[];
  browserSamples: TraceBrowserSample[];
  cpuSamples: TraceCpuSample[];
  extensionSamples: TraceExtensionSample[];
  functionWindows: TraceFunctionWindow[];
  metadata?: LocalRecordingSummary;
  traces: Map<string, TraceEvent[]>;
}

function consumeRecordingLine(
  state: JsonlRecordingState,
  line: JsonlRecordingLine,
): void {
  if (line.type === 'metadata') {
    state.metadata = line as LocalRecordingSummary;
    return;
  }
  if (consumeSummaryLine(state, line)) {
    return;
  }
  if (consumeSampleLine(state, line)) {
    return;
  }
  if (line.type === 'events' && line.ray && line.events) {
    const events = state.traces.get(line.ray) ?? [];
    events.push(...line.events);
    state.traces.set(line.ray, events);
  }
}

function consumeSummaryLine(
  state: JsonlRecordingState,
  line: JsonlRecordingLine,
): boolean {
  if (line.type === 'aggregate' && line.aggregate) {
    state.aggregates.push(line.aggregate);
    return true;
  }
  if (line.type === 'function-window' && line.window) {
    state.functionWindows.push(line.window);
    return true;
  }
  return false;
}

function consumeSampleLine(
  state: JsonlRecordingState,
  line: JsonlRecordingLine,
): boolean {
  if (line.type === 'cpu-sample' && line.sample) {
    state.cpuSamples.push(line.sample as TraceCpuSample);
    return true;
  }
  if (line.type === 'browser-sample' && line.sample) {
    state.browserSamples.push(line.sample as TraceBrowserSample);
    return true;
  }
  if (line.type === 'extension-sample' && line.sample) {
    state.extensionSamples.push(line.sample as TraceExtensionSample);
    return true;
  }
  return false;
}

export function createRecordingClient(serverUrl = '') {
  const baseUrl = serverUrl.replace(/\/$/, '');
  async function loadLocalRecording(
    sessionId: string,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal,
  ): Promise<TraceRecording> {
    const response = await fetch(
      `${baseUrl}/api/recordings/${encodeURIComponent(sessionId)}`,
      { signal },
    );
    if (!response.ok) {
      throw new Error(`Could not load the saved session (${response.status}).`);
    }
    if (!response.body) {
      return parseRecordingJsonl(await response.text());
    }
    const totalBytes = Number(response.headers.get('content-length')) || 0;
    return parseRecordingJsonlStream(response.body, (loadedBytes) => {
      onProgress?.(totalBytes ? Math.min(loadedBytes / totalBytes, 1) : 0);
    });
  }

  async function listLocalRecordings(
    signal?: AbortSignal,
  ): Promise<LocalRecordingSummary[]> {
    const response = await fetch(`${baseUrl}/api/recordings`, { signal });
    if (!response.ok) {
      throw new Error(`Could not list saved sessions (${response.status}).`);
    }
    return (await response.json()) as LocalRecordingSummary[];
  }

  async function deleteLocalRecording(sessionId: string): Promise<void> {
    const response = await fetch(
      `${baseUrl}/api/recordings/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      throw new Error(
        `Could not remove the saved session (${response.status}).`,
      );
    }
  }

  async function clearLocalRecording(sessionId: string): Promise<void> {
    const response = await fetch(
      `${baseUrl}/api/recordings/${encodeURIComponent(sessionId)}/clear`,
      { method: 'POST' },
    );
    if (!response.ok) {
      throw new Error(
        `Could not clear the active session (${response.status}).`,
      );
    }
  }

  return {
    clear: clearLocalRecording,
    list: listLocalRecordings,
    load: loadLocalRecording,
    remove: deleteLocalRecording,
  };
}
const localClient = createRecordingClient();
export const loadLocalRecording = localClient.load;
export const listLocalRecordings = localClient.list;
export const deleteLocalRecording = localClient.remove;
export const clearLocalRecording = localClient.clear;

function isRecording(value: unknown): value is TraceRecording {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<TraceRecording>;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.duration === 'number' &&
    Array.isArray(candidate.traces) &&
    candidate.traces.every(
      (trace) =>
        trace && typeof trace.ray === 'string' && Array.isArray(trace.events),
    )
  );
}

export function buildRows(recording: TraceRecording): EventRow[] {
  const rows: EventRow[] = [];
  for (const trace of recording.traces) {
    const byId = new Map(trace.events.map((event) => [event.id, event]));
    const children = new Map<number, number>();
    for (const event of trace.events) {
      if (event.parent) {
        children.set(event.parent, (children.get(event.parent) ?? 0) + 1);
      }
    }
    let traceStart = Number.POSITIVE_INFINITY;
    for (const event of trace.events) {
      traceStart = Math.min(traceStart, event.at);
    }
    if (!Number.isFinite(traceStart)) {
      traceStart = 0;
    }
    for (const event of trace.events) {
      const row = event as EventRow;
      row.childCount = children.get(event.id) ?? 0;
      row.depth = getDepth(event, byId);
      row.relativeAt = event.at - traceStart;
      rows.push(row);
    }
  }
  return rows.sort((left, right) => left.at - right.at);
}

export function orderRowsAsTree(rows: EventRow[]): EventRow[] {
  const rowsByRay = new Map<string, EventRow[]>();
  for (const row of rows) {
    const rayRows = rowsByRay.get(row.ray);
    if (rayRows) {
      rayRows.push(row);
    } else {
      rowsByRay.set(row.ray, [row]);
    }
  }

  const rays = [...rowsByRay.values()].sort(
    (left, right) => (left[0]?.at ?? 0) - (right[0]?.at ?? 0),
  );
  const ordered: EventRow[] = [];
  for (const rayRows of rays) {
    appendRayTree(rayRows, ordered);
  }
  return ordered;
}

function appendRayTree(rayRows: EventRow[], target: EventRow[]): void {
  const { children, roots } = indexRayTree(rayRows);
  const seen = new Set<number>();
  const stack = [...roots].reverse();
  while (stack.length) {
    const row = stack.pop()!;
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    target.push(row);
    const rowChildren = children.get(row.id) ?? [];
    for (let index = rowChildren.length - 1; index >= 0; index -= 1) {
      stack.push(rowChildren[index]!);
    }
  }

  for (const row of rayRows) {
    if (!seen.has(row.id)) {
      target.push(row);
    }
  }
}

function indexRayTree(rayRows: EventRow[]): {
  children: Map<number, EventRow[]>;
  roots: EventRow[];
} {
  const ids = new Set(rayRows.map(({ id }) => id));
  const children = new Map<number, EventRow[]>();
  const roots: EventRow[] = [];
  for (const row of rayRows) {
    if (row.parent === undefined || !ids.has(row.parent)) {
      roots.push(row);
      continue;
    }
    const siblings = children.get(row.parent);
    if (siblings) {
      siblings.push(row);
    } else {
      children.set(row.parent, [row]);
    }
  }
  return { children, roots };
}

function getDepth(event: TraceEvent, byId: Map<number, TraceEvent>): number {
  let depth = 0;
  let parent = event.parent ? byId.get(event.parent) : undefined;
  const seen = new Set<number>();
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    depth += 1;
    parent = parent.parent ? byId.get(parent.parent) : undefined;
  }
  return depth;
}

export function formatDuration(duration?: number): string {
  if (duration === undefined) {
    return '—';
  }
  if (duration < 1) {
    return `${(duration * 1_000).toFixed(0)} μs`;
  }
  if (duration < 1_000) {
    return `${duration.toFixed(duration < 10 ? 2 : 1)} ms`;
  }
  return `${(duration / 1_000).toFixed(2)} s`;
}
