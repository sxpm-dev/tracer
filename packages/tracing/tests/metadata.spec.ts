// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addTraceExtensionSample,
  getActiveTraceRay,
  getGlobalTracing,
  getRecordingState,
  marker,
  releaseRecording,
  setTraceRayMetadata,
  startRecording,
  trace,
  type TraceRayHandle,
} from '../src';

afterEach(() => {
  vi.restoreAllMocks();
  if (getRecordingState().isRecording) {
    releaseRecording();
  }
});

describe('ray context', () => {
  it('exposes optional body markers on the global recorder without capturing arguments', () => {
    const api = getGlobalTracing();
    expect(api.isRecordingActive?.()).toBe(false);
    startRecording({ cpu: false, mode: 'full', withArguments: false });
    expect(api.isRecordingActive?.()).toBe(true);
    api.run(
      'responsive-editor',
      'getIndicators',
      () => {
        api.marker?.('indicatorComputation', {
          bodySequence: 1,
          memoizationMode: 'state',
        });
      },
      undefined,
      [],
    );
    const recording = releaseRecording();
    expect(recording.traces[0].events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: { bodySequence: 1, memoizationMode: 'state' },
          kind: 'marker',
          name: 'getIndicators.indicatorComputation',
        }),
      ]),
    );
    expect(api.isRecordingActive?.()).toBe(false);
  });

  it('replaces an older global tracer before a browser-only recording', async () => {
    const key = Symbol.for('@sx/tracing/runtime/v2');
    const priorRuntime = Reflect.get(globalThis, key);
    const priorGlobal = Object.getOwnPropertyDescriptor(
      globalThis,
      '__EDITOR_TRACING__',
    );
    const oldRun = vi.fn();
    const oldApi = {
      getRecordingState: () => ({ isRecording: false }),
      record: vi.fn(),
      recordSession: vi.fn(),
      release: vi.fn(),
      releaseSession: vi.fn(),
      run: oldRun,
      wrapService: vi.fn(),
    };
    Reflect.deleteProperty(globalThis, key);
    Object.defineProperty(globalThis, '__EDITOR_TRACING__', {
      configurable: true,
      value: oldApi,
    });
    vi.resetModules();
    try {
      const fresh = await import('@sx/recordings');
      expect(fresh.getGlobalTracing()).toBe(oldApi);
      expect(fresh.getGlobalTracing().marker).toBe(fresh.marker);
      expect(fresh.getGlobalTracing().isRecordingActive).toBe(
        fresh.isRecordingActive,
      );
      expect(oldApi.recordSession).toBe(fresh.recordSession);
      fresh.startRecording({ cpu: false, mode: 'browser' });
      expect(
        globalThis.__EDITOR_TRACING__?.run('test', 'call', () => 42, null, []),
      ).toBe(42);
      expect(oldRun).not.toHaveBeenCalled();
      expect(fresh.getRecordingState().eventCount).toBe(0);
      expect(fresh.getRecordingState().traceCount).toBe(0);
      expect(fresh.releaseRecording().traces).toEqual([]);
    } finally {
      if (priorRuntime) {
        Reflect.set(globalThis, key, priorRuntime);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
      if (priorGlobal) {
        Object.defineProperty(globalThis, '__EDITOR_TRACING__', priorGlobal);
      } else {
        Reflect.deleteProperty(globalThis, '__EDITOR_TRACING__');
      }
    }
  });

  it('captures browser metrics without tracing instrumented calls', () => {
    const originalMemory = Object.getOwnPropertyDescriptor(
      performance,
      'memory',
    );
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: { usedJSHeapSize: 1024 },
    });
    try {
      const state = startRecording({
        browser: {
          cpuPressure: false,
          eventTiming: false,
          frameRate: false,
          layoutShifts: false,
          memory: 'heap',
          resources: false,
          timerLag: false,
          visibility: false,
        },
        cpu: false,
        mode: 'browser',
      });
      expect(state.mode).toBe('browser');
      expect(trace(() => 42, 'work')()).toBe(42);
      expect(() =>
        trace(() => {
          throw new Error('failure');
        }, 'failure')(),
      ).toThrow('failure');
      marker('ignored');
      addTraceExtensionSample('custom', { ignored: true });
      const recording = releaseRecording();
      expect(recording.browserSamples).toEqual([
        expect.objectContaining({
          metric: 'memory.js-heap-used',
          value: 1024,
        }),
      ]);
      expect(recording.mode).toBe('browser');
      expect(recording.traces).toEqual([]);
      expect(recording.aggregates).toEqual([]);
      expect(recording.extensionSamples).toEqual([]);
    } finally {
      if (originalMemory) {
        Object.defineProperty(performance, 'memory', originalMemory);
      } else {
        Reflect.deleteProperty(performance, 'memory');
      }
    }
  });

  it('aligns call, marker, and extension timestamps to the recording origin', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    startRecording({ cpu: false });
    clock.mockReturnValue(1100);
    trace(() => {
      marker('checkpoint');
      addTraceExtensionSample('app.observation', { ok: true });
    }, 'flow')();
    clock.mockReturnValue(1200);
    const recording = releaseRecording();
    expect(recording.timelineOrigin).toBe(1000);
    expect(recording.duration).toBe(200);
    expect(recording.traces[0].events.map((event) => event.at)).toEqual([
      100, 100,
    ]);
    expect(recording.extensionSamples?.[0].at).toBe(100);
  });

  it('snapshots namespaced metadata and keeps a handle across await', async () => {
    startRecording({ cpu: false });
    let handle: TraceRayHandle | undefined;
    await trace(async () => {
      handle = getActiveTraceRay();
      const context = { componentId: 'one' };
      expect(setTraceRayMetadata('platform.selection', context)).toBe(true);
      context.componentId = 'mutated';
      await Promise.resolve();
      expect(
        setTraceRayMetadata('editor.operation', { name: 'resize' }, handle),
      ).toBe(true);
    }, 'resize')();
    const recording = releaseRecording();
    expect(recording.traces[0].metadata).toEqual({
      'editor.operation': { name: 'resize' },
      'platform.selection': { componentId: 'one' },
    });
    expect(
      recording.extensionSamples?.filter(
        (sample) => sample.channel === 'tracing.ray-metadata',
      ),
    ).toHaveLength(2);
    expect(setTraceRayMetadata('platform.selection', {}, handle)).toBe(false);
    startRecording();
    expect(setTraceRayMetadata('platform.selection', {}, handle)).toBe(false);
  });

  it('does not invent rays in light mode and rejects oversized payloads', () => {
    startRecording({ cpu: false, mode: 'light' });
    trace(() => expect(setTraceRayMetadata('platform', {})).toBe(false))();
    expect(releaseRecording().traces).toEqual([]);
    startRecording({ cpu: false });
    trace(() => {
      expect(() => setTraceRayMetadata('platform', 'x'.repeat(17000))).toThrow(
        '16 KiB',
      );
      expect(() => setTraceRayMetadata('', {})).toThrow('identifier');
    })();
  });

  it('routes imports from another module instance into the same owner', async () => {
    startRecording({ cpu: false });
    vi.resetModules();
    const other = await import('../src');
    expect(other.getRecordingState().sessionId).toBe(
      getRecordingState().sessionId,
    );
    other.trace(
      () => {
        marker('from-first');
        other.setTraceRayMetadata('other', { ok: true });
        addTraceExtensionSample('first.sample', 1);
      },
      'second-copy',
      { namespace: 'other' },
    )();
    const recording = other.releaseRecording();
    expect(recording.traces[0].events.map((event) => event.kind)).toContain(
      'marker',
    );
    expect(recording.traces[0].metadata).toEqual({ other: { ok: true } });
    expect(
      recording.extensionSamples?.some(
        (sample) => sample.channel === 'first.sample',
      ),
    ).toBe(true);
  });
});
