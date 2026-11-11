// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getRecordingState,
  marker,
  releaseRecording,
  startRecording,
  trace,
} from '../src';

afterEach(() => {
  vi.unstubAllGlobals();
  if (getRecordingState().isRecording) {
    releaseRecording();
  }
});

describe('low-overhead full recordings', () => {
  it('skips async stack recovery but preserves synchronous children and settled durations', async () => {
    startRecording({ captureAsyncContext: false, cpu: false });
    const NativeError = globalThis.Error;
    let capturedStacks = 0;
    vi.stubGlobal(
      'Error',
      class extends NativeError {
        constructor(message?: string) {
          super(message);
          capturedStacks += 1;
        }
      },
    );
    const child = trace(() => marker('inside'), 'child');
    await trace(async () => {
      child();
      await Promise.resolve();
      child();
    }, 'parent')();
    vi.unstubAllGlobals();
    const state = getRecordingState();
    const recording = releaseRecording();
    const events = recording.traces.flatMap((ray) => ray.events);
    expect(capturedStacks).toBe(0);
    expect(recording.traces).toHaveLength(2);
    expect(
      events
        .filter((event) => event.name === 'child')
        .map((event) => event.parent),
    ).toEqual([1, undefined]);
    expect(events.filter((event) => event.kind === 'marker')).toHaveLength(2);
    expect(events.find((event) => event.name === 'parent')).toMatchObject({
      duration: expect.any(Number),
      status: 'ok',
    });
    expect(state.eventCount).toBe(events.length);
    expect(recording.extensionSamples).toContainEqual(
      expect.objectContaining({
        channel: 'tracing.configuration',
        data: { captureAsyncContext: false },
      }),
    );
  });

  it('records rejected promises without changing their rejection', async () => {
    startRecording({ captureAsyncContext: false, cpu: false });
    const failure = new Error('failed action');
    const action = trace(async () => {
      await Promise.resolve();
      throw failure;
    }, 'action');
    await expect(action()).rejects.toBe(failure);
    expect(releaseRecording().traces[0].events[0]).toMatchObject({
      duration: expect.any(Number),
      error: { message: 'failed action' },
      status: 'error',
    });
  });

  it('counts in-flight calls and markers incrementally and resets between recordings', async () => {
    startRecording({ cpu: false });
    let finish!: () => void;
    const promise = trace(() => {
      marker('started');
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }, 'action')();
    expect(getRecordingState().eventCount).toBe(2);
    for (let index = 0; index < 100; index += 1) {
      trace(() => undefined, 'leaf')();
    }
    expect(getRecordingState().eventCount).toBe(102);
    finish();
    await promise;
    const recording = releaseRecording();
    expect(
      recording.traces.reduce((sum, ray) => sum + ray.events.length, 0),
    ).toBe(102);
    startRecording({ cpu: false });
    expect(getRecordingState().eventCount).toBe(0);
  });
});
