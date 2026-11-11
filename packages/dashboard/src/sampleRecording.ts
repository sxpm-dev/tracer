import type {
  TraceBrowserMetric,
  TraceBrowserSample,
  TraceEvent,
  TraceRecording,
  TraceRecordingMode,
} from './types';

const startedAt = '2026-09-25T09:00:00.000Z';
const sessionDuration = 60_000;
const metrics: Record<
  TraceBrowserMetric,
  { unit: TraceBrowserSample['unit']; value: (i: number) => number }
> = {
  'cpu.pressure': { unit: 'level', value: (i) => Math.floor(i / 5) % 4 },
  'event.duration': { unit: 'ms', value: (i) => 16 + (i % 7) * 32 },
  'event.input-delay': { unit: 'ms', value: (i) => (i % 9) * 8 },
  'event.processing': { unit: 'ms', value: (i) => 8 + (i % 6) * 20 },
  'frame.fps': { unit: 'fps', value: (i) => 60 - (i % 8) * 5 },
  'layout.shift': { unit: 'score', value: (i) => (i % 11 === 0 ? 0.12 : 0) },
  'memory.js-heap-used': {
    unit: 'bytes',
    value: (i) => (64 + (i % 15) * 3) * 1_048_576,
  },
  'memory.ua-total': {
    unit: 'bytes',
    value: (i) => (120 + (i % 15) * 4) * 1_048_576,
  },
  'page.visibility': {
    unit: 'state',
    value: (i) => (i >= 40 && i < 44 ? 0 : 1),
  },
  'resource.duration': { unit: 'ms', value: (i) => 20 + (i % 6) * 45 },
  'resource.transfer-size': {
    unit: 'bytes',
    value: (i) => 1024 * (16 + (i % 10) * 24),
  },
  'timer.lag': { unit: 'ms', value: (i) => (i % 8) * 12 },
};

function sampleTrace(index: number): TraceRecording['traces'][number] {
  const ray = `sample-interaction-${index}`;
  const at = index * 480;
  const failed = index % 13 === 0;
  const heap = (64 + (index % 15) * 3) * 1_048_576;
  const events: TraceEvent[] = [
    {
      arguments: [{ documentId: `document-${index % 8}`, source: 'sample' }],
      at,
      data: { result: { ready: !failed }, synthetic: true },
      duration: 120 + (index % 5) * 40,
      id: 1,
      kind: 'call',
      name: 'openDocument',
      namespace: 'workspace',
      ray,
      status: failed ? 'error' : 'ok',
    },
    {
      arguments: [`document-${index % 8}`, { includeChildren: true }],
      at: at + 4,
      duration: index % 4 === 0 ? 75 : 2,
      error: failed
        ? {
            message: 'Synthetic request timed out',
            name: 'SampleNetworkError',
            stack:
              'SampleNetworkError: Synthetic request timed out\n  at loadDocument (sample.ts:42)',
          }
        : undefined,
      id: 2,
      kind: 'call',
      name: 'loadDocument',
      namespace: 'data',
      parent: 1,
      ray,
      status: failed ? 'error' : 'ok',
    },
    {
      arguments: [{ key: index % 8 }],
      at: at + 6,
      data: { result: ['header', 'content', 'footer'] },
      duration: 1,
      id: 3,
      kind: 'call',
      name: 'readIndex',
      namespace: 'storage',
      parent: 2,
      ray,
      status: 'ok',
    },
    {
      arguments: [{ nodes: 40 + index }],
      at: at + 85,
      duration: 25 + (index % 6) * 8,
      id: 4,
      kind: 'call',
      memory: {
        deltaBytes: (index % 3 === 0 ? -2 : 1) * 1_048_576,
        endBytes: heap + (index % 3 === 0 ? -2 : 1) * 1_048_576,
        startBytes: heap,
      },
      name: 'renderDocument',
      namespace: 'renderer',
      parent: 1,
      ray,
      status: 'ok',
    },
    {
      arguments: [
        [
          { id: 'header', width: 960 },
          { id: 'content', width: 960 },
        ],
      ],
      at: at + 90,
      duration: 8,
      id: 5,
      kind: 'call',
      name: 'layoutChildren',
      namespace: 'renderer',
      parent: 4,
      ray,
      status: 'ok',
    },
    {
      at: at + 115,
      data: { documentId: `document-${index % 8}`, synthetic: true },
      id: 6,
      kind: 'marker',
      name: 'document-ready',
      namespace: 'workspace',
      parent: 1,
      ray,
    },
    {
      at: at + 116,
      data: { documentId: `document-${index % 8}`, synthetic: true },
      id: 7,
      kind: 'marker',
      name: 'cache-written',
      namespace: 'storage',
      parent: 1,
      ray,
    },
    {
      at: at + 118,
      data: { nodes: 40 + index, synthetic: true },
      id: 8,
      kind: 'marker',
      name: 'render-committed',
      namespace: 'renderer',
      parent: 1,
      ray,
    },
  ];
  return {
    events,
    metadata: {
      cohort: 'sample',
      documentId: `document-${index % 8}`,
      interaction: 'open-document',
      synthetic: true,
    },
    ray,
  };
}

function fullSample(): TraceRecording {
  return {
    browserCapabilities: [
      'cpu-pressure',
      'event-timing',
      'frame-rate',
      'layout-shifts',
      'memory',
      'resources',
      'timer-lag',
      'visibility',
    ].map((name) => ({
      name,
      reason: 'Synthetic demonstration data; not a measurement of this device.',
      status: 'active',
    })),
    browserSamples: Array.from({ length: 60 }, (_, i) =>
      Object.entries(metrics).map(([metric, spec]) => ({
        at: i * 1000,
        detail: { synthetic: 'true' },
        metric: metric as TraceBrowserMetric,
        source: 'sample',
        unit: spec.unit,
        value: spec.value(i),
      })),
    ).flat(),
    cpuSamples: Array.from({ length: 30 }, (_, i) => ({
      at: i * 2000,
      blockingDuration: 20 + (i % 5) * 35,
      duration: 70 + (i % 5) * 35,
      firstUiEventAt: i * 2000 + 1,
      renderAt: i * 2000 + 10,
      scripts: [
        {
          duration: 50 + (i % 5) * 35,
          forcedStyleAndLayoutDuration: 12,
          functionName: 'renderDocument',
          invoker: 'sample interaction',
          sourceUrl: 'sample://renderer.ts',
        },
      ],
      source: 'long-animation-frame' as const,
      styleAndLayoutAt: i * 2000 + 15,
    })),
    cpuSource: 'long-animation-frame',
    droppedBrowserSamples: 0,
    droppedFunctionWindows: 0,
    duration: sessionDuration,
    extensionSamples: [
      {
        at: 0,
        channel: 'sample.environment',
        data: {
          build: 'demo',
          synthetic: true,
          viewport: { height: 900, width: 1440 },
        },
      },
    ],
    mode: 'full',
    releasedAt: new Date(Date.parse(startedAt) + sessionDuration).toISOString(),
    schemaVersion: 1,
    sessionId: 'sample-full',
    startedAt,
    status: 'complete',
    timelineOrigin: 0,
    title: 'Sample · Full feature tour',
    traces: Array.from({ length: 120 }, (_, index) => sampleTrace(index)),
  };
}

/** Deterministic synthetic data, independent of browser capture API availability. */
export function createSampleRecording(
  mode: TraceRecordingMode = 'full',
): TraceRecording {
  const recording = fullSample();
  if (mode === 'full') {
    return recording;
  }
  const aggregates = new Map<
    string,
    NonNullable<TraceRecording['aggregates']>[number]
  >();
  const functionWindows: NonNullable<TraceRecording['functionWindows']> = [];
  for (const trace of recording.traces) {
    const functions = trace.events
      .filter((event) => event.kind === 'call')
      .map((event) => {
        const duration = event.duration ?? 0;
        const key = `${event.namespace}.${event.name}`;
        const item = aggregates.get(key) ?? {
          argumentExample: event.arguments,
          calls: 0,
          errors: 0,
          maxDuration: 0,
          minDuration: Infinity,
          name: event.name,
          namespace: event.namespace!,
          totalDuration: 0,
        };
        item.calls += 1;
        item.errors += event.status === 'error' ? 1 : 0;
        item.totalDuration += duration;
        item.maxDuration = Math.max(item.maxDuration, duration);
        item.minDuration = Math.min(item.minDuration, duration);
        aggregates.set(key, item);
        return {
          calls: 1,
          errors: event.status === 'error' ? 1 : 0,
          maxDuration: duration,
          name: event.name,
          namespace: event.namespace!,
          totalDuration: duration,
        };
      });
    functionWindows.push({
      at: trace.events[0].at,
      functions,
      otherCalls: 0,
      otherDuration: 0,
      span: 480,
    });
  }
  return {
    ...recording,
    aggregates: [...aggregates.values()],
    functionWindows,
    mode: 'light',
    sessionId: 'sample-light',
    title: 'Sample · Lightweight capture',
    traces: [],
  };
}
