import {
  getCompletedRecordingUpdates,
  subscribeRecordingUpdates,
  type TraceBrowserSample,
  type TraceCpuSample,
  type TraceEvent,
  type TraceExtensionSample,
  type TraceFunctionAggregate,
  type TraceFunctionWindow,
  type TraceRecording,
  type TraceRecordingState,
  type TraceRecordingUpdate,
} from '@sx/tracing';

export interface TraceSessionOptions {
  serverUrl: string;
  uploadBatchBytes?: number;
  uploadBatchCalls?: number;
  uploadIntervalMs?: number;
}

interface RemoteRecordingSession {
  failure?: unknown;
  flushInterval?: ReturnType<typeof setInterval>;
  pendingAggregates: TraceFunctionAggregate[];
  pendingBrowserSamples: TraceBrowserSample[];
  pendingCpuSamples: TraceCpuSample[];
  pendingEventCount: number;
  pendingEvents: Map<string, TraceEvent[]>;
  pendingExtensionSamples: TraceExtensionSample[];
  pendingFunctionWindows: TraceFunctionWindow[];
  seenBrowserSamples: Set<TraceBrowserSample>;
  seenCpuSamples: Set<TraceCpuSample>;
  seenEvents: Set<string>;
  seenExtensionSamples: Set<TraceExtensionSample>;
  serverUrl: string;
  sessionId: string;
  startRequest: Promise<void>;
  title: string;
  unsubscribe?: () => void;
  uploadBatchBytes: number;
  uploadBatchCalls: number;
  uploadChain: Promise<void>;
  uploading: boolean;
}

const DEFAULT_BATCH_BYTES = 512 * 1024;
const DEFAULT_BATCH_CALLS = 500;
const DEFAULT_UPLOAD_INTERVAL_MS = 1_000;
const MIN_BATCH_BYTES = 64 * 1024;
const MIN_BATCH_CALLS = 10;
const MIN_UPLOAD_INTERVAL_MS = 250;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_BATCH_CALLS = 5_000;

let remoteSession: RemoteRecordingSession | undefined;

export function startRecordingTransport(
  title: string,
  state: TraceRecordingState,
  options: TraceSessionOptions,
): Promise<void> {
  if (!state.sessionId || !state.startedAt) {
    throw new Error('Platform tracing did not create a recording session');
  }
  if (!title.trim()) {
    throw new Error('A recording session title is required');
  }

  const serverUrl = normalizeServerUrl(options.serverUrl);
  const uploadBatchBytes = clampBatchBytes(options.uploadBatchBytes);
  const uploadBatchCalls = clampBatchCalls(options.uploadBatchCalls);
  const uploadIntervalMs = Math.max(
    MIN_UPLOAD_INTERVAL_MS,
    options.uploadIntervalMs ?? DEFAULT_UPLOAD_INTERVAL_MS,
  );
  const startRequest = request(serverUrl, '/api/recordings/start', {
    browserCapabilities: state.browserCapabilities,
    cpuSource: state.cpuSource,
    mode: state.mode,
    sessionId: state.sessionId,
    startedAt: state.startedAt,
    timelineOrigin: state.timelineOrigin,
    title: title.trim(),
  });
  const session: RemoteRecordingSession = {
    pendingAggregates: [],
    pendingBrowserSamples: [],
    pendingCpuSamples: [],
    pendingEventCount: 0,
    pendingEvents: new Map(),
    pendingExtensionSamples: [],
    pendingFunctionWindows: [],
    seenBrowserSamples: new Set(),
    seenCpuSamples: new Set(),
    seenEvents: new Set(),
    seenExtensionSamples: new Set(),
    serverUrl,
    sessionId: state.sessionId,
    startRequest,
    title: title.trim(),
    uploadBatchBytes,
    uploadBatchCalls,
    uploadChain: startRequest,
    uploading: false,
  };
  remoteSession = session;
  return startRequest
    .catch((error: unknown) => {
      if (remoteSession?.sessionId === state.sessionId) {
        remoteSession = undefined;
      }
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Recording server health check failed for ${serverUrl}: ${detail}`,
      );
    })
    .then(() => {
      if (remoteSession !== session) {
        return;
      }
      session.unsubscribe = subscribeRecordingUpdates((update) => {
        enqueueUpdate(session, update);
      });
      for (const update of getCompletedRecordingUpdates()) {
        enqueueUpdate(session, update);
      }
      session.flushInterval = globalThis.setInterval(() => {
        queueFlush(session);
      }, uploadIntervalMs);
      queueFlushIfFull(session);
    });
}

export function cancelRecordingTransport(sessionId: string): void {
  if (remoteSession?.sessionId === sessionId) {
    stopLiveStreaming(remoteSession);
    remoteSession = undefined;
  }
}

export function hasRecordingTransport(): boolean {
  return remoteSession !== undefined;
}

export async function uploadRecording(
  recording: TraceRecording,
): Promise<void> {
  const session = remoteSession;
  remoteSession = undefined;
  if (!session) {
    return;
  }

  stopLiveStreaming(session);
  const released = request(
    session.serverUrl,
    `/api/recordings/${encodeURIComponent(recording.sessionId)}/release`,
    { duration: recording.duration, releasedAt: recording.releasedAt },
  );
  enqueueRecordingTail(session, recording);
  const [releaseResult, batchesResult] = await Promise.allSettled([
    released,
    flushSession(session),
  ]);
  if (batchesResult.status === 'rejected') {
    throw batchesResult.reason;
  }
  if (releaseResult.status === 'rejected') {
    throw releaseResult.reason;
  }
  if (session.failure) {
    throw session.failure;
  }
  await request(
    session.serverUrl,
    `/api/recordings/${encodeURIComponent(recording.sessionId)}/finish`,
    finishMetadata(recording),
  );
}

function finishMetadata(recording: TraceRecording): Record<string, unknown> {
  return {
    aggregateCallCount:
      recording.aggregates?.reduce(
        (total, aggregate) => total + aggregate.calls,
        0,
      ) ?? 0,
    browserCapabilities: recording.browserCapabilities,
    browserSampleCount: recording.browserSamples?.length ?? 0,
    cpuSampleCount: recording.cpuSamples?.length ?? 0,
    cpuSource: recording.cpuSource,
    droppedBrowserSamples: recording.droppedBrowserSamples,
    droppedFunctionWindows: recording.droppedFunctionWindows,
    duration: recording.duration,
    eventCount: recording.traces.reduce(
      (total, trace) => total + trace.events.length,
      0,
    ),
    functionWindowCount: recording.functionWindows?.length ?? 0,
    mode: recording.mode,
    releasedAt: recording.releasedAt,
    timelineOrigin: recording.timelineOrigin,
    traceCount: recording.traces.length,
  };
}

function enqueueUpdate(
  session: RemoteRecordingSession,
  update: TraceRecordingUpdate,
): void {
  if (update.sessionId !== session.sessionId) {
    return;
  }
  if (update.type === 'extension-sample') {
    if (session.seenExtensionSamples.has(update.sample)) {
      return;
    }
    session.seenExtensionSamples.add(update.sample);
    session.pendingExtensionSamples.push(update.sample);
  } else if (update.type === 'browser-sample') {
    if (session.seenBrowserSamples.has(update.sample)) {
      return;
    }
    session.seenBrowserSamples.add(update.sample);
    session.pendingBrowserSamples.push(update.sample);
  } else if (update.type === 'cpu-sample') {
    if (session.seenCpuSamples.has(update.sample)) {
      return;
    }
    session.seenCpuSamples.add(update.sample);
    session.pendingCpuSamples.push(update.sample);
  } else {
    const key = eventKey(update.event);
    if (session.seenEvents.has(key)) {
      return;
    }
    session.seenEvents.add(key);
    const events = session.pendingEvents.get(update.event.ray) ?? [];
    events.push(update.event);
    session.pendingEvents.set(update.event.ray, events);
    session.pendingEventCount += 1;
  }
  queueFlushIfFull(session);
}

function enqueueRecordingTail(
  session: RemoteRecordingSession,
  recording: TraceRecording,
): void {
  session.pendingAggregates.push(...(recording.aggregates ?? []));
  session.pendingFunctionWindows.push(...(recording.functionWindows ?? []));
  enqueueTailSamples(session, recording);
  for (const trace of recording.traces) {
    for (const event of trace.events) {
      enqueueUpdate(session, {
        event,
        sessionId: recording.sessionId,
        type: 'event',
      });
    }
  }
}

function enqueueTailSamples(
  session: RemoteRecordingSession,
  recording: TraceRecording,
): void {
  for (const sample of recording.browserSamples ?? []) {
    enqueueUpdate(session, {
      sample,
      sessionId: recording.sessionId,
      type: 'browser-sample',
    });
  }
  for (const sample of recording.extensionSamples ?? []) {
    enqueueUpdate(session, {
      sample,
      sessionId: recording.sessionId,
      type: 'extension-sample',
    });
  }
  for (const sample of recording.cpuSamples ?? []) {
    enqueueUpdate(session, {
      sample,
      sessionId: recording.sessionId,
      type: 'cpu-sample',
    });
  }
}

function queueFlushIfFull(session: RemoteRecordingSession): void {
  if (session.pendingEventCount >= session.uploadBatchCalls) {
    queueFlush(session);
  }
}

function queueFlush(session: RemoteRecordingSession): void {
  if (session.uploading || session.failure) {
    return;
  }
  void flushSession(session).catch((error: unknown) => {
    session.failure = error;
    stopLiveStreaming(session);
    console.error('Could not stream the trace recording.', error);
  });
}

function hasPendingData(session: RemoteRecordingSession): boolean {
  return Boolean(
    session.pendingAggregates.length ||
    session.pendingBrowserSamples.length ||
    session.pendingFunctionWindows.length ||
    session.pendingExtensionSamples.length ||
    session.pendingCpuSamples.length ||
    session.pendingEventCount,
  );
}

function takePendingBatches(
  session: RemoteRecordingSession,
): Generator<string> {
  const batches = createUploadBatches(
    session.pendingAggregates,
    session.pendingBrowserSamples,
    session.pendingFunctionWindows,
    session.pendingExtensionSamples,
    session.pendingCpuSamples,
    [...session.pendingEvents],
    session.uploadBatchBytes,
    session.uploadBatchCalls,
  );
  session.pendingAggregates = [];
  session.pendingBrowserSamples = [];
  session.pendingFunctionWindows = [];
  session.pendingExtensionSamples = [];
  session.pendingCpuSamples = [];
  session.pendingEvents = new Map();
  session.pendingEventCount = 0;
  return batches;
}

function flushSession(session: RemoteRecordingSession): Promise<void> {
  if (session.uploading || session.failure || !hasPendingData(session)) {
    return session.uploadChain;
  }
  // One uploader owns the drain. Producers keep writing into the pending
  // buffers instead of allocating another promise and snapshot per flush.
  session.uploading = true;
  session.uploadChain = session.uploadChain.then(async () => {
    try {
      while (hasPendingData(session)) {
        for (const batch of takePendingBatches(session)) {
          await requestText(
            session.serverUrl,
            `/api/recordings/${encodeURIComponent(session.sessionId)}/batches`,
            batch,
            'application/x-ndjson',
          );
        }
      }
    } finally {
      session.uploading = false;
    }
  });
  return session.uploadChain;
}

function stopLiveStreaming(session: RemoteRecordingSession): void {
  session.unsubscribe?.();
  session.unsubscribe = undefined;
  if (session.flushInterval !== undefined) {
    globalThis.clearInterval(session.flushInterval);
    session.flushInterval = undefined;
  }
}

function eventKey(event: TraceEvent): string {
  return `${event.ray}:${event.id}`;
}

function* createUploadBatches(
  aggregates: TraceFunctionAggregate[],
  browserSamples: TraceBrowserSample[],
  functionWindows: TraceFunctionWindow[],
  extensionSamples: TraceExtensionSample[],
  cpuSamples: TraceCpuSample[],
  traces: [string, TraceEvent[]][],
  maxBytes: number,
  maxEventsPerLine: number,
): Generator<string> {
  let batch = '';
  const append = function* (line: string): Generator<string> {
    if (batch && batch.length + line.length + 1 > maxBytes) {
      yield batch;
      batch = '';
    }
    batch += `${line}\n`;
  };

  for (const aggregate of aggregates) {
    yield* append(JSON.stringify({ aggregate, type: 'aggregate' }));
  }
  for (const window of functionWindows) {
    yield* append(JSON.stringify({ type: 'function-window', window }));
  }
  for (const sample of browserSamples) {
    yield* append(JSON.stringify({ sample, type: 'browser-sample' }));
  }
  for (const sample of extensionSamples) {
    yield* append(JSON.stringify({ sample, type: 'extension-sample' }));
  }
  for (const sample of cpuSamples) {
    yield* append(JSON.stringify({ sample, type: 'cpu-sample' }));
  }
  for (const [ray, traceEvents] of traces) {
    for (const events of chunkEvents(traceEvents, maxEventsPerLine)) {
      yield* append(JSON.stringify({ events, ray, type: 'events' }));
    }
  }
  if (batch) {
    yield batch;
  }
}

function* chunkEvents(
  events: TraceEvent[],
  chunkSize: number,
): Generator<TraceEvent[]> {
  for (let index = 0; index < events.length; index += chunkSize) {
    yield events.slice(index, index + chunkSize);
  }
}

function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid recording server URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('The recording server URL must use http or https');
  }
  return url.href.replace(/\/$/, '');
}

function clampBatchBytes(value?: number): number {
  return Math.min(
    MAX_BATCH_BYTES,
    Math.max(MIN_BATCH_BYTES, value ?? DEFAULT_BATCH_BYTES),
  );
}

function clampBatchCalls(value?: number): number {
  return Math.min(
    MAX_BATCH_CALLS,
    Math.max(MIN_BATCH_CALLS, value ?? DEFAULT_BATCH_CALLS),
  );
}

async function request(
  serverUrl: string,
  path: string,
  body: unknown,
): Promise<void> {
  await requestText(serverUrl, path, JSON.stringify(body), 'application/json');
}

async function requestText(
  serverUrl: string,
  path: string,
  body: string,
  contentType: string,
): Promise<void> {
  const response = await fetch(`${serverUrl}${path}`, {
    body,
    headers: { 'content-type': contentType },
    method: 'POST',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Recording server rejected the upload (${response.status})${
        detail ? `: ${detail}` : ''
      }`,
    );
  }
}
