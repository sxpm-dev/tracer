import type { IncomingMessage, ServerResponse } from 'node:http';

import { createReadStream } from 'node:fs';
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';

import type { TraceCaptureCapability, TraceRecording } from './types';

import {
  discardSessionIndex,
  indexProgress,
  queryIndexedSession,
} from './sessionIndex';

interface RecordingMetadata {
  aggregateCallCount?: number;
  browserCapabilities?: TraceCaptureCapability[];
  browserSampleCount?: number;
  clearedAt?: string;
  cpuSampleCount: number;
  cpuSource?: 'long-animation-frame' | 'long-task' | 'unavailable';
  dataStartedAt?: string;
  droppedBrowserSamples?: number;
  droppedFunctionWindows?: number;
  duration?: number;
  eventCount: number;
  functionWindowCount?: number;
  mode?: 'browser' | 'full' | 'light';
  rayIndexComplete?: boolean;
  releasedAt?: string;
  sessionId: string;
  startedAt: string;
  status: 'complete' | 'recording';
  timelineOrigin?: number;
  title: string;
  traceCount: number;
  updatedAt: string;
}

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const SESSION_ID = /^[a-zA-Z0-9_-]+$/;
const sessionMutations = new Map<string, Promise<void>>();

export function resolveRecordingsDirectory(directory = '.recordings'): string {
  return resolve(directory);
}

export function createRecordingMiddleware({
  onRecordingDeleted,
  recordingsDirectory,
}: {
  onRecordingDeleted?: (id: string) => Promise<void>;
  recordingsDirectory?: string;
} = {}) {
  const directory = resolveRecordingsDirectory(recordingsDirectory);
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (!request.url?.startsWith('/api/recordings')) {
      next();
      return;
    }
    setCorsHeaders(response);
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    try {
      await mkdir(directory, { recursive: true });
      await handleRequest(
        request,
        response,
        directory,
        onRecordingDeleted,
      );
    } catch (error) {
      if (response.headersSent || response.destroyed) {
        response.destroy();
        return;
      }
      response.statusCode =
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
      response.setHeader('content-type', 'text/plain; charset=utf-8');
      response.end(error instanceof Error ? error.message : 'Server error');
    }
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
  onRecordingDeleted?: (id: string) => Promise<void>,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (request.method === 'GET') {
    await handleGetRequest(response, directory, parts, url.searchParams);
    return;
  }
  if (request.method === 'POST') {
    await handlePostRequest(request, response, directory, parts);
    return;
  }
  if (request.method === 'DELETE') {
    await handleDeleteRequest(response, directory, parts, onRecordingDeleted);
    return;
  }
  sendError(response, 405, 'Method not allowed');
}

async function handleDeleteRequest(
  response: ServerResponse,
  directory: string,
  parts: string[],
  onRecordingDeleted?: (id: string) => Promise<void>,
): Promise<void> {
  const sessionId = validSessionId(response, parts[2]);
  if (!sessionId) {
    return;
  }
  if (parts.length !== 3) {
    sendError(response, 404, 'Recording endpoint not found');
    return;
  }
  await mutateSession(sessionId, async () => {
    if (!(await isDiscarded(directory, sessionId))) {
      await readMetadata(directory, sessionId);
    }
    await Promise.all([
      rm(dataPath(directory, sessionId), { force: true }),
      rm(metadataPath(directory, sessionId), { force: true }),
      rm(raysPath(directory, sessionId), { force: true }),
    ]);
    await writeFile(discardedPath(directory, sessionId), '', 'utf8');
    await discardSessionIndex(dataPath(directory, sessionId), sessionId);
    await onRecordingDeleted?.(sessionId);
  });
  response.statusCode = 204;
  response.end();
}

async function handleGetRequest(
  response: ServerResponse,
  directory: string,
  parts: string[],
  params: URLSearchParams,
): Promise<void> {
  if (parts.length === 2) {
    await listRecordings(response, directory);
    return;
  }
  const sessionId = validSessionId(response, parts[2]);
  if (!sessionId) {
    return;
  }
  if (parts[3] === 'progress' && parts.length === 4) {
    sendJson(response, indexProgress(dataPath(directory, sessionId)));
    return;
  }
  if (parts.length === 3) {
    await sendRecording(response, directory, sessionId);
    return;
  }
  if (
    parts.length === 4 &&
    [
      'analytics',
      'call-paths',
      'export',
      'extensions',
      'frames',
      'rays',
      'report-evidence',
      'summary',
    ].includes(parts[3])
  ) {
    await sendSessionQuery(response, directory, sessionId, parts[3], params);
    return;
  }
  sendError(response, 404, 'Recording endpoint not found');
}

async function sendSessionQuery(
  response: ServerResponse,
  directory: string,
  id: string,
  kind: string,
  params: URLSearchParams,
) {
  let metadata!: RecordingMetadata;
  let fingerprint!: { mtimeMs: number; size: number };
  await mutateSession(id, async () => {
    metadata = await readMetadata(directory, id);
    fingerprint = await stat(dataPath(directory, id));
  });
  const now = metadata.updatedAt;
  const recording: TraceRecording = {
    browserCapabilities: metadata.browserCapabilities,
    cpuSource: metadata.cpuSource,
    droppedBrowserSamples: metadata.droppedBrowserSamples,
    droppedFunctionWindows: metadata.droppedFunctionWindows,
    duration: visibleDuration(metadata, now),
    mode: metadata.mode,
    releasedAt: metadata.releasedAt ?? now,
    schemaVersion: 1,
    sessionId: id,
    startedAt: metadata.dataStartedAt ?? metadata.startedAt,
    status: metadata.status,
    timelineOrigin: metadata.timelineOrigin,
    title: metadata.title,
    traces: [],
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  response.once('close', abort);
  response.setHeader('cache-control', 'no-store');
  try {
    const result = await queryIndexedSession(
      dataPath(directory, id),
      recording,
      kind,
      params,
      controller.signal,
      fingerprint,
      kind === 'export' || kind === 'report-evidence'
        ? (progress) => {
            if (!response.headersSent) {
              response.setHeader('content-type', 'application/x-ndjson');
            }
            response.write(JSON.stringify({ progress }) + '\n');
          }
        : undefined,
    );
    if (kind === 'export' || kind === 'report-evidence') {
      response.end(JSON.stringify({ snapshot: result }) + '\n');
      return;
    }
    response.setHeader('cache-control', 'no-store');
    sendJson(response, result);
  } finally {
    response.off('close', abort);
  }
}

async function handlePostRequest(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
  parts: string[],
): Promise<void> {
  if (parts[2] === 'start') {
    await startRecording(request, response, directory);
    return;
  }
  const sessionId = validSessionId(response, parts[2]);
  if (!sessionId) {
    return;
  }
  if (parts[3] === 'batches') {
    const body = await readBody(request);
    await mutateSession(sessionId, async () => {
      if (await isDiscarded(directory, sessionId)) {
        return;
      }
      const metadata = await readMetadata(directory, sessionId);
      if (metadata.status !== 'recording') {
        throw new Error('Cannot append to a completed recording');
      }
      await appendFile(dataPath(directory, sessionId), body, 'utf8');
      await updateLiveMetadata(directory, sessionId, body);
    });
    sendJson(response, { ok: true });
    return;
  }
  if (parts[3] === 'clear') {
    await mutateSession(sessionId, async () => {
      if (!(await isDiscarded(directory, sessionId))) {
        await clearRecordingData(directory, sessionId);
      }
    });
    sendJson(response, { ok: true });
    return;
  }
  if (parts[3] === 'release') {
    const body = await readBody(request);
    await mutateSession(sessionId, async () => {
      if (await isDiscarded(directory, sessionId)) {
        sendJson(response, { ok: true });
        return;
      }
      const metadata = await markRecordingReleased(body, directory, sessionId);
      sendJson(response, metadata);
    });
    return;
  }
  if (parts[3] === 'finish') {
    const body = await readBody(request);
    await mutateSession(sessionId, async () => {
      if (await isDiscarded(directory, sessionId)) {
        sendJson(response, { ok: true });
        return;
      }
      await finishRecording(body, response, directory, sessionId);
    });
    return;
  }
  sendError(response, 404, 'Recording endpoint not found');
}

async function markRecordingReleased(
  body: string,
  directory: string,
  sessionId: string,
): Promise<RecordingMetadata> {
  const input = JSON.parse(body) as Pick<
    RecordingMetadata,
    'duration' | 'releasedAt'
  >;
  const metadata = await readMetadata(directory, sessionId);
  if (metadata.status !== 'recording') {
    throw new Error('Cannot release a completed recording');
  }
  if (
    typeof input.duration !== 'number' ||
    !Number.isFinite(input.duration) ||
    input.duration < 0 ||
    !input.releasedAt ||
    !Number.isFinite(Date.parse(input.releasedAt))
  ) {
    throw new Error('Invalid recording release time');
  }
  const released = {
    ...metadata,
    duration: metadata.clearedAt
      ? elapsedMilliseconds(metadata.dataStartedAt, input.releasedAt)
      : input.duration,
    releasedAt: input.releasedAt,
    updatedAt: new Date().toISOString(),
  };
  await writeMetadata(directory, released);
  return released;
}

async function updateLiveMetadata(
  directory: string,
  sessionId: string,
  body: string,
): Promise<void> {
  const counts = countBatch(body);
  const metadata = await readMetadata(directory, sessionId);
  if (metadata.status !== 'recording') {
    throw new Error('Cannot append to a completed recording');
  }
  if (counts.rays.length) {
    await appendFile(
      raysPath(directory, sessionId),
      `${counts.rays.join('\n')}\n`,
      'utf8',
    );
  }
  await writeMetadata(directory, {
    ...metadata,
    aggregateCallCount:
      (metadata.aggregateCallCount ?? 0) + counts.aggregateCalls,
    browserSampleCount:
      (metadata.browserSampleCount ?? 0) + counts.browserSamples,
    cpuSampleCount: (metadata.cpuSampleCount ?? 0) + counts.cpuSamples,
    eventCount: metadata.eventCount + counts.events,
    functionWindowCount:
      (metadata.functionWindowCount ?? 0) + counts.functionWindows,
    traceCount: metadata.traceCount + counts.rays.length,
    updatedAt: new Date().toISOString(),
  });
}

interface BatchCounts {
  aggregateCalls: number;
  browserSamples: number;
  cpuSamples: number;
  events: number;
  functionWindows: number;
  rays: string[];
}

interface BatchItem {
  aggregate?: { calls?: number };
  events?: unknown[];
  ray?: string;
  sample?: { channel?: string };
  type?: string;
}

function countBatch(body: string): BatchCounts {
  const counts: BatchCounts = {
    aggregateCalls: 0,
    browserSamples: 0,
    cpuSamples: 0,
    events: 0,
    functionWindows: 0,
    rays: [],
  };
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    countBatchItem(counts, JSON.parse(line) as BatchItem);
  }
  return counts;
}

function countBatchItem(counts: BatchCounts, item: BatchItem): void {
  if (item.type === 'events') {
    counts.events += item.events?.length ?? 0;
    if (item.ray) {
      counts.rays.push(item.ray);
    }
    return;
  }
  countNonEventBatchItem(counts, item);
}

function countNonEventBatchItem(counts: BatchCounts, item: BatchItem): void {
  switch (item.type) {
    case 'aggregate':
      counts.aggregateCalls += item.aggregate?.calls ?? 0;
      break;
    case 'browser-sample':
      counts.browserSamples += 1;
      break;
    case 'cpu-sample':
      counts.cpuSamples += 1;
      break;
    case 'function-window':
      counts.functionWindows += 1;
      break;
  }
}

function validSessionId(
  response: ServerResponse,
  value?: string,
): string | undefined {
  if (value && SESSION_ID.test(value)) {
    return value;
  }
  sendError(response, 400, 'Invalid recording session id');
  return undefined;
}

async function startRecording(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
): Promise<void> {
  const input = JSON.parse(
    await readBody(request),
  ) as Partial<RecordingMetadata>;
  if (!input.sessionId || !SESSION_ID.test(input.sessionId)) {
    sendError(response, 400, 'Invalid recording session id');
    return;
  }
  const sessionId = input.sessionId;
  const metadata: RecordingMetadata = {
    aggregateCallCount: 0,
    browserCapabilities: input.browserCapabilities,
    browserSampleCount: 0,
    cpuSampleCount: 0,
    cpuSource: input.cpuSource,
    dataStartedAt: input.startedAt ?? new Date().toISOString(),
    eventCount: 0,
    functionWindowCount: 0,
    mode: input.mode ?? 'full',
    rayIndexComplete: true,
    sessionId: input.sessionId,
    startedAt: input.startedAt ?? new Date().toISOString(),
    status: 'recording',
    timelineOrigin: input.timelineOrigin,
    title: input.title?.trim() || input.sessionId,
    traceCount: 0,
    updatedAt: new Date().toISOString(),
  };
  await mutateSession(sessionId, async () => {
    if (await isDiscarded(directory, sessionId)) {
      sendError(response, 410, 'This recording was deleted');
      return;
    }
    await writeFile(dataPath(directory, sessionId), '', 'utf8');
    await writeFile(raysPath(directory, sessionId), '', 'utf8');
    await writeMetadata(directory, metadata);
    sendJson(response, metadata, 201);
  });
}

async function finishRecording(
  body: string,
  response: ServerResponse,
  directory: string,
  sessionId: string,
): Promise<void> {
  const input = JSON.parse(body) as Partial<RecordingMetadata>;
  const existing = await readMetadata(directory, sessionId);
  const releasedAt =
    input.releasedAt ?? existing.releasedAt ?? new Date().toISOString();
  const liveTraceCount = await completedTraceCount(
    existing,
    directory,
    sessionId,
  );
  const metadata: RecordingMetadata = {
    ...existing,
    browserCapabilities:
      input.browserCapabilities ?? existing.browserCapabilities,
    cpuSampleCount: input.cpuSampleCount ?? existing.cpuSampleCount,
    cpuSource: input.cpuSource ?? existing.cpuSource,
    droppedBrowserSamples: input.droppedBrowserSamples,
    droppedFunctionWindows: input.droppedFunctionWindows,
    duration: completedDuration(existing, input, releasedAt),
    mode: input.mode ?? existing.mode,
    releasedAt,
    status: 'complete',
    timelineOrigin: input.timelineOrigin ?? existing.timelineOrigin,
    traceCount: liveTraceCount ?? input.traceCount ?? existing.traceCount,
    updatedAt: new Date().toISOString(),
  };
  await writeMetadata(directory, metadata);
  sendJson(response, metadata);
}

async function completedTraceCount(
  existing: RecordingMetadata,
  directory: string,
  sessionId: string,
): Promise<number | undefined> {
  return existing.rayIndexComplete
    ? countRecordedRays(directory, sessionId)
    : undefined;
}

function completedDuration(
  existing: RecordingMetadata,
  input: Partial<RecordingMetadata>,
  releasedAt: string,
): number | undefined {
  return existing.clearedAt
    ? elapsedMilliseconds(existing.dataStartedAt, releasedAt)
    : input.duration;
}

async function listRecordings(
  response: ServerResponse,
  directory: string,
): Promise<void> {
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith('.meta.json'),
  );
  const entries = await Promise.all(
    files.map(async (file) => {
      const contents = await readFile(resolve(directory, file), 'utf8').catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') {
            return undefined;
          }
          throw error;
        },
      );
      if (contents === undefined) {
        return undefined;
      }
      const metadata = JSON.parse(contents) as RecordingMetadata;
      const data = await stat(dataPath(directory, metadata.sessionId)).catch(
        () => undefined,
      );
      return { ...metadata, bytes: data?.size ?? 0 };
    }),
  );
  const recordings = entries.filter((entry) => entry !== undefined);
  recordings.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  sendJson(response, recordings);
}

async function sendRecording(
  response: ServerResponse,
  directory: string,
  sessionId: string,
): Promise<void> {
  const metadata = await readMetadata(directory, sessionId);
  const snapshotTime = new Date().toISOString();
  const metadataLine = `${JSON.stringify({
    ...metadata,
    duration: visibleDuration(metadata, snapshotTime),
    releasedAt:
      metadata.status === 'recording' && !metadata.releasedAt
        ? snapshotTime
        : metadata.releasedAt,
    startedAt: metadata.dataStartedAt ?? metadata.startedAt,
    type: 'metadata',
  })}\n`;
  const data = await stat(dataPath(directory, sessionId));
  response.statusCode = 200;
  response.setHeader(
    'content-length',
    Buffer.byteLength(metadataLine) + data.size,
  );
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  response.write(metadataLine);
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(dataPath(directory, sessionId));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
    stream.pipe(response, { end: false });
  });
  response.end();
}

async function readMetadata(
  directory: string,
  sessionId: string,
): Promise<RecordingMetadata> {
  return JSON.parse(
    await readFile(metadataPath(directory, sessionId), 'utf8'),
  ) as RecordingMetadata;
}

async function writeMetadata(
  directory: string,
  metadata: RecordingMetadata,
): Promise<void> {
  await writeFile(
    metadataPath(directory, metadata.sessionId),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );
}

function dataPath(directory: string, sessionId: string): string {
  return resolve(directory, `${sessionId}.jsonl`);
}

function metadataPath(directory: string, sessionId: string): string {
  return resolve(directory, `${sessionId}.meta.json`);
}

function raysPath(directory: string, sessionId: string): string {
  return resolve(directory, `${sessionId}.rays`);
}

function discardedPath(directory: string, sessionId: string): string {
  return resolve(directory, `${sessionId}.deleted`);
}

async function isDiscarded(
  directory: string,
  sessionId: string,
): Promise<boolean> {
  try {
    await stat(discardedPath(directory, sessionId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function clearRecordingData(
  directory: string,
  sessionId: string,
): Promise<void> {
  const metadata = await readMetadata(directory, sessionId);
  if (metadata.status !== 'recording') {
    throw new Error('Only an active recording can be cleared');
  }
  const clearedAt = new Date().toISOString();
  await Promise.all([
    writeFile(dataPath(directory, sessionId), '', 'utf8'),
    writeFile(raysPath(directory, sessionId), '', 'utf8'),
  ]);
  await writeMetadata(directory, {
    ...metadata,
    aggregateCallCount: 0,
    browserSampleCount: 0,
    clearedAt,
    cpuSampleCount: 0,
    dataStartedAt: clearedAt,
    duration: undefined,
    eventCount: 0,
    functionWindowCount: 0,
    rayIndexComplete: true,
    traceCount: 0,
    updatedAt: clearedAt,
  });
}

async function countRecordedRays(
  directory: string,
  sessionId: string,
): Promise<number | undefined> {
  const source = await readFile(raysPath(directory, sessionId), 'utf8').catch(
    () => undefined,
  );
  if (source === undefined) {
    return undefined;
  }
  return new Set(source.split(/\r?\n/).filter(Boolean)).size;
}

function elapsedMilliseconds(start?: string, end?: string): number {
  const elapsed = Date.parse(end ?? '') - Date.parse(start ?? '');
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

function visibleDuration(metadata: RecordingMetadata, now: string): number {
  return metadata.status === 'recording' && !metadata.releasedAt
    ? elapsedMilliseconds(metadata.dataStartedAt, now)
    : (metadata.duration ?? 0);
}

async function mutateSession(
  sessionId: string,
  mutation: () => Promise<void>,
): Promise<void> {
  const previous = sessionMutations.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(mutation);
  sessionMutations.set(sessionId, current);
  try {
    await current;
  } finally {
    if (sessionMutations.get(sessionId) === current) {
      sessionMutations.delete(sessionId);
    }
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error('Recording batch is larger than 8 MB');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader(
    'access-control-allow-methods',
    'DELETE, GET, POST, OPTIONS',
  );
  response.setHeader('access-control-allow-headers', 'content-type');
  response.setHeader('access-control-allow-private-network', 'true');
}

function sendJson(
  response: ServerResponse,
  value: unknown,
  status = 200,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

function sendError(
  response: ServerResponse,
  status: number,
  message: string,
): void {
  response.statusCode = status;
  response.setHeader('content-type', 'text/plain; charset=utf-8');
  response.end(message);
}
