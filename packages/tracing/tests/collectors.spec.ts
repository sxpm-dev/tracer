import { describe, expect, it, vi } from 'vitest';

import {
  registerTraceCollector,
  releaseRecording,
  startRecording,
} from '../src';

describe('trace collectors', () => {
  it('fans a recording out to every registered collector', () => {
    const calls: string[] = [];
    const first = registerTraceCollector({
      name: 'test.first',
      onStart: () => calls.push('first:start'),
      onStop: () => calls.push('first:stop'),
    });
    const second = registerTraceCollector({
      name: 'test.second',
      onStart: () => calls.push('second:start'),
      onStop: () => calls.push('second:stop'),
    });

    try {
      startRecording({ cpu: false });
      releaseRecording();
    } finally {
      second();
      first();
    }

    expect(calls).toEqual([
      'first:start',
      'second:start',
      'first:stop',
      'second:stop',
    ]);
  });

  it('passes the state and options through to onStart', () => {
    const onStart = vi.fn();
    const unregister = registerTraceCollector({
      name: 'test.options',
      onStart,
    });

    try {
      const state = startRecording({ cpu: false, mode: 'light' });
      expect(onStart).toHaveBeenCalledWith(
        state,
        expect.objectContaining({ mode: 'light' }),
      );
    } finally {
      releaseRecording();
      unregister();
    }
  });

  it('applies decorators in registration order', () => {
    const first = registerTraceCollector({
      decorate: (recording) => ({ ...recording, title: 'first' }),
      name: 'test.decorate-first',
    });
    const second = registerTraceCollector({
      decorate: (recording) => ({
        ...recording,
        title: `${recording.title}+second`,
      }),
      name: 'test.decorate-second',
    });

    try {
      startRecording({ cpu: false });
      expect(releaseRecording().title).toBe('first+second');
    } finally {
      second();
      first();
    }
  });

  it('registering the same name twice replaces the earlier collector', () => {
    const replaced = vi.fn();
    const winner = vi.fn();
    registerTraceCollector({ name: 'test.duplicate', onStart: replaced });
    const unregister = registerTraceCollector({
      name: 'test.duplicate',
      onStart: winner,
    });

    try {
      startRecording({ cpu: false });
    } finally {
      releaseRecording();
      unregister();
    }

    expect(replaced).not.toHaveBeenCalled();
    expect(winner).toHaveBeenCalledTimes(1);
  });

  it('records a failing collector as data and keeps the recording', () => {
    const healthy = vi.fn();
    const broken = registerTraceCollector({
      name: 'test.throws',
      onStart: () => {
        throw new Error('collector failed');
      },
    });
    const survivor = registerTraceCollector({
      name: 'test.survivor',
      onStart: healthy,
    });

    try {
      startRecording({ cpu: false });
      const recording = releaseRecording();

      expect(healthy).toHaveBeenCalledTimes(1);
      expect(
        recording.extensionSamples?.find(
          ({ channel }) => channel === 'tracing.collector-error',
        )?.data,
      ).toMatchObject({ collector: 'test.throws', hook: 'onStart' });
    } finally {
      survivor();
      broken();
    }
  });

  it('reports a failing decorator without losing the recording', () => {
    const unregister = registerTraceCollector({
      decorate: () => {
        throw new Error('decorate failed');
      },
      name: 'test.decorate-throws',
    });

    try {
      startRecording({ cpu: false });
      const recording = releaseRecording();

      expect(recording.sessionId).toBeDefined();
      expect(
        recording.extensionSamples?.find(
          ({ channel }) => channel === 'tracing.collector-error',
        )?.data,
      ).toMatchObject({ collector: 'test.decorate-throws', hook: 'decorate' });
    } finally {
      unregister();
    }
  });

  it('unregistering stops a collector taking part', () => {
    const onStart = vi.fn();
    registerTraceCollector({ name: 'test.removed', onStart })();

    startRecording({ cpu: false });
    releaseRecording();

    expect(onStart).not.toHaveBeenCalled();
  });

  it('still loads when an older copy owns the shared runtime', async () => {
    // An owner installed by an earlier version has none of the APIs added
    // since. Exporting undefined for those would throw during session.ts
    // initialisation, so the current copy backs them itself.
    const key = Symbol.for('@sx/tracing/runtime/v2');
    const previousOwner = Reflect.get(globalThis, key);
    const previousGlobal = Object.getOwnPropertyDescriptor(
      globalThis,
      '__EDITOR_TRACING__',
    );
    Reflect.set(globalThis, key, {
      getRecordingState: () => ({
        eventCount: 0,
        isRecording: false,
        traceCount: 0,
      }),
      releaseRecording: () => ({ traces: [] }),
      startRecording: () => ({ isRecording: true }),
      // registerTraceCollector and setGlobalSessionApi deliberately absent.
    });
    Reflect.deleteProperty(globalThis, '__EDITOR_TRACING__');
    vi.resetModules();

    try {
      const fresh = await import('../src');
      expect(typeof fresh.registerTraceCollector).toBe('function');
      expect(typeof fresh.setGlobalSessionApi).toBe('function');
      // Shared state still comes from the owner that claimed the symbol.
      expect(fresh.getRecordingState().isRecording).toBe(false);
    } finally {
      if (previousOwner) {
        Reflect.set(globalThis, key, previousOwner);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
      if (previousGlobal) {
        Object.defineProperty(globalThis, '__EDITOR_TRACING__', previousGlobal);
      } else {
        Reflect.deleteProperty(globalThis, '__EDITOR_TRACING__');
      }
      vi.resetModules();
    }
  });
});
