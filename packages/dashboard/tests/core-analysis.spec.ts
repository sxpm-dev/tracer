import { describe, expect, it } from 'vitest';

import type { TraceRecording } from '../src/types';

import { analyzeCoreRecording } from '../src/coreAnalysis';

const base: TraceRecording = {
  duration: 200,
  releasedAt: '2026-09-24T12:00:00.200Z',
  schemaVersion: 1,
  sessionId: 'core-test',
  startedAt: '2026-09-24T12:00:00.000Z',
  traces: [],
};

describe('core dashboard analysis', () => {
  it('summarizes calls, roots, browser blocking, and generic findings', () => {
    const recording: TraceRecording = {
      ...base,
      cacheSnapshots: [
        {
          at: 0,
          capturedAt: base.startedAt,
          measurement: 'estimated',
          namespaces: [],
          totalBytes: 999_999,
        },
      ],
      cpuSamples: [
        {
          at: 40,
          blockingDuration: 60,
          duration: 70,
          source: 'long-task',
        },
      ],
      traces: [
        {
          events: [
            {
              at: 5,
              duration: 120,
              id: 1,
              kind: 'call',
              name: 'run',
              namespace: 'app',
              ray: 'ray-a',
              status: 'ok',
            },
            {
              at: 10,
              duration: 20,
              id: 2,
              kind: 'call',
              name: 'read',
              namespace: 'store',
              parent: 1,
              ray: 'ray-a',
              status: 'error',
            },
            { at: 15, id: 3, kind: 'marker', name: 'checkpoint', ray: 'ray-a' },
          ],
          ray: 'ray-a',
        },
      ],
    };

    const result = analyzeCoreRecording(recording);

    expect(result.calls).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.roots).toEqual([{ calls: 2, key: 'app.run', rays: 1 }]);
    expect(result.blockingTotal).toBe(60);
    expect(result.functions).toHaveLength(2);
    expect(result.findings.map((finding) => finding.id)).toEqual([
      'errors:store:read',
      'slow:app:run',
      'main-thread-blocking',
    ]);
    expect(JSON.stringify(result)).not.toContain('999999');
  });

  it('filters function costs by root without removing root options', () => {
    const recording: TraceRecording = {
      ...base,
      traces: [
        {
          events: [
            {
              at: 0,
              duration: 4,
              id: 1,
              kind: 'call',
              name: 'a',
              namespace: 'root',
              ray: 'a',
            },
            {
              at: 1,
              duration: 2,
              id: 2,
              kind: 'call',
              name: 'work',
              namespace: 'shared',
              parent: 1,
              ray: 'a',
            },
          ],
          ray: 'a',
        },
        {
          events: [
            {
              at: 10,
              duration: 8,
              id: 3,
              kind: 'call',
              name: 'b',
              namespace: 'root',
              ray: 'b',
            },
            {
              at: 11,
              duration: 3,
              id: 4,
              kind: 'call',
              name: 'work',
              namespace: 'shared',
              parent: 3,
              ray: 'b',
            },
          ],
          ray: 'b',
        },
      ],
    };

    const result = analyzeCoreRecording(recording, 'root.a');

    expect(result.calls).toBe(2);
    expect(result.functions.find((item) => item.name === 'work')?.calls).toBe(
      1,
    );
    expect(result.roots).toHaveLength(2);
  });

  it('uses light-mode aggregates without inventing frames or call activity', () => {
    const result = analyzeCoreRecording({
      ...base,
      aggregates: [
        {
          calls: 50,
          errors: 2,
          maxDuration: 110,
          minDuration: 1,
          name: 'run',
          namespace: 'app',
          totalDuration: 500,
        },
      ],
      mode: 'light',
    });

    expect(result.calls).toBe(50);
    expect(result.errors).toBe(2);
    expect(result.functions[0]?.totalDuration).toBe(500);
    expect(result.rays).toEqual([]);
    expect(result.activity.every((value) => value === 0)).toBe(true);
  });

  it('aligns light-mode function windows with the recording timeline', () => {
    const result = analyzeCoreRecording({
      ...base,
      aggregates: [
        {
          calls: 6,
          errors: 0,
          maxDuration: 8,
          minDuration: 1,
          name: 'run',
          namespace: 'app',
          totalDuration: 20,
        },
      ],
      functionWindows: [
        {
          at: 100,
          functions: [
            {
              calls: 4,
              errors: 0,
              maxDuration: 8,
              name: 'run',
              namespace: 'app',
              totalDuration: 16,
            },
          ],
          otherCalls: 2,
          otherDuration: 4,
          span: 10,
        },
      ],
      mode: 'light',
    });

    expect(result.calls).toBe(6);
    expect(result.activity.reduce((sum, calls) => sum + calls, 0)).toBeCloseTo(
      6,
    );
    expect(result.activity).toEqual([6]);
    expect(result.rootActivity).toBeUndefined();
    expect(result.rays).toEqual([]);
  });
});
