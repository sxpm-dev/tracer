// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  TraceEvent,
  TraceRecording,
  TraceRecordingUpdate,
} from '@sx/tracing';

import {
  cancelRecordingTransport,
  startRecordingTransport,
  uploadRecording,
} from '../src/transport';

const updates = vi.hoisted(() => ({
  listener: undefined as ((update: TraceRecordingUpdate) => void) | undefined,
}));
vi.mock('@sx/tracing', () => ({
  getCompletedRecordingUpdates: () => [],
  subscribeRecordingUpdates: (listener: typeof updates.listener) => {
    updates.listener = listener;
    return () => {
      updates.listener = undefined;
    };
  },
}));

const sessionId = 'test-session';
const event = (id: number): TraceEvent => ({
  at: id,
  id,
  kind: 'call',
  name: 'move',
  ray: 'drag',
});
const recording = (events: TraceEvent[]): TraceRecording => ({
  duration: 100,
  releasedAt: '2026-09-27',
  schemaVersion: 1,
  sessionId,
  startedAt: '2026-09-27',
  traces: [{ events, ray: 'drag' }],
});
const start = () =>
  startRecordingTransport(
    'drag',
    {
      eventCount: 0,
      isRecording: true,
      sessionId,
      startedAt: '2026-09-27',
      traceCount: 0,
    },
    { serverUrl: 'http://localhost:3000', uploadBatchCalls: 10 },
  );
const emit = (id: number) =>
  updates.listener?.({ event: event(id), sessionId, type: 'event' });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cancelRecordingTransport(sessionId);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recording upload backpressure', () => {
  it('coalesces updates behind one uploader and flushes the complete tail before finish', async () => {
    let releaseBatch!: (value: Response) => void;
    const firstBatch = new Promise<Response>((resolve) => {
      releaseBatch = resolve;
    });
    const bodies: string[] = [];
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, options: RequestInit) => {
        paths.push(url);
        if (url.endsWith('/batches')) {
          bodies.push(options.body as string);
          if (bodies.length === 1) {
            return firstBatch;
          }
        }
        return Promise.resolve({ ok: true } as Response);
      }),
    );
    await start();
    for (let id = 0; id < 10; id++) {
      emit(id);
    }
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    // Several full flushes arrive while the network is stalled.
    for (let id = 10; id < 45; id++) {
      emit(id);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(bodies).toHaveLength(1);
    const finished = uploadRecording(
      recording(Array.from({ length: 46 }, (_, id) => event(id))),
    );
    expect(paths.some((path) => path.endsWith('/finish'))).toBe(false);
    releaseBatch({ ok: true } as Response);
    await finished;
    expect(bodies).toHaveLength(2);
    const ids = bodies.flatMap((body) =>
      body
        .trim()
        .split('\n')
        .flatMap((line) =>
          JSON.parse(line).events.map((entry: TraceEvent) => entry.id),
        ),
    );
    expect(ids).toEqual(Array.from({ length: 46 }, (_, id) => id));
    expect(paths.at(-1)).toMatch(/\/finish$/);
  });

  it('stops streaming and does not finish a recording when a batch fails', async () => {
    const error = new Error('offline');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn((url: string) =>
      url.endsWith('/batches')
        ? Promise.reject(error)
        : Promise.resolve({ ok: true } as Response),
    );
    vi.stubGlobal('fetch', fetch);
    await start();
    for (let id = 0; id < 10; id++) {
      emit(id);
    }
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
    expect(updates.listener).toBeUndefined();
    await expect(uploadRecording(recording([]))).rejects.toBe(error);
    expect(fetch.mock.calls.some(([url]) => url.endsWith('/finish'))).toBe(
      false,
    );
  });
});
