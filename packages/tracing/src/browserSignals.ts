import type {
  TraceBrowserCaptureOptions,
  TraceBrowserMetric,
  TraceBrowserSample,
  TraceCaptureCapability,
} from './tracing';

interface BrowserSignalSink {
  capability: (value: TraceCaptureCapability) => void;
  sample: (value: TraceBrowserSample) => void;
}

interface TimedEntry extends PerformanceEntry {
  hadRecentInput?: boolean;
  initiatorType?: string;
  interactionId?: number;
  processingEnd?: number;
  processingStart?: number;
  transferSize?: number;
  value?: number;
}

interface HeapPerformance extends Performance {
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  memory?: { usedJSHeapSize?: number };
}

interface PressureRecord {
  state: 'critical' | 'fair' | 'nominal' | 'serious';
  time: number;
}

interface PressureObserverLike {
  disconnect: () => void;
  observe: (
    source: string,
    options: { sampleInterval: number },
  ) => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 1_000;
const PRESSURE_LEVEL = { critical: 3, fair: 1, nominal: 0, serious: 2 };

export function startBrowserSignals(
  origin: number,
  options: TraceBrowserCaptureOptions,
  sink: BrowserSignalSink,
): () => void {
  const stops: (() => void)[] = [];
  const intervalMs = Math.max(
    250,
    options.sampleIntervalMs ?? DEFAULT_INTERVAL_MS,
  );
  const emit = (
    metric: TraceBrowserMetric,
    value: number,
    unit: TraceBrowserSample['unit'],
    source: string,
    at = performance.now() - origin,
    detail?: TraceBrowserSample['detail'],
  ) => {
    if (Number.isFinite(value)) {
      sink.sample({ at: Math.max(0, at), detail, metric, source, unit, value });
    }
  };

  observeEntries(
    'event',
    options.eventTiming !== false,
    sink,
    stops,
    (entry) => {
      const at = entry.startTime - origin;
      const detail = {
        event: entry.name,
        interactionId: entry.interactionId ?? 0,
      };
      emit('event.duration', entry.duration, 'ms', 'event-timing', at, detail);
      if (entry.processingStart !== undefined) {
        emit(
          'event.input-delay',
          entry.processingStart - entry.startTime,
          'ms',
          'event-timing',
          at,
          detail,
        );
      }
      if (
        entry.processingEnd !== undefined &&
        entry.processingStart !== undefined
      ) {
        emit(
          'event.processing',
          entry.processingEnd - entry.processingStart,
          'ms',
          'event-timing',
          at,
          detail,
        );
      }
    },
    { durationThreshold: 16 },
  );

  observeEntries(
    'layout-shift',
    options.layoutShifts !== false,
    sink,
    stops,
    (entry) => {
      if (!entry.hadRecentInput) {
        emit(
          'layout.shift',
          entry.value ?? 0,
          'score',
          'layout-shift',
          entry.startTime - origin,
        );
      }
    },
  );

  observeEntries(
    'resource',
    options.resources !== false,
    sink,
    stops,
    (entry) => {
      if (entry.duration < (options.resourceMinDurationMs ?? 50)) {
        return;
      }
      const at = entry.startTime - origin;
      const detail = { initiatorType: entry.initiatorType ?? 'other' };
      emit(
        'resource.duration',
        entry.duration,
        'ms',
        'resource-timing',
        at,
        detail,
      );
      if (entry.transferSize !== undefined) {
        emit(
          'resource.transfer-size',
          entry.transferSize,
          'bytes',
          'resource-timing',
          at,
          detail,
        );
      }
    },
  );

  startMemorySampling(
    origin,
    options.memory ?? 'auto',
    intervalMs,
    sink,
    emit,
    stops,
  );
  startTimerLag(options.timerLag !== false, intervalMs, sink, emit, stops);
  startFrameRate(options.frameRate !== false, intervalMs, sink, emit, stops);
  startVisibility(options.visibility !== false, sink, emit, stops);
  startCpuPressure(
    origin,
    options.cpuPressure === true,
    intervalMs,
    sink,
    emit,
    stops,
  );

  return () => {
    for (const stop of stops) {
      stop();
    }
  };
}

type Emit = (
  metric: TraceBrowserMetric,
  value: number,
  unit: TraceBrowserSample['unit'],
  source: string,
  at?: number,
  detail?: TraceBrowserSample['detail'],
) => void;

function observeEntries(
  type: string,
  enabled: boolean,
  sink: BrowserSignalSink,
  stops: (() => void)[],
  capture: (entry: TimedEntry) => void,
  extra: Record<string, unknown> = {},
): void {
  if (!enabled) {
    sink.capability({ name: type, status: 'disabled' });
    return;
  }
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes?.includes(type)
  ) {
    sink.capability({ name: type, status: 'unsupported' });
    return;
  }
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as TimedEntry[]) {
      capture(entry);
    }
  });
  try {
    observer.observe({
      buffered: false,
      type,
      ...extra,
    } as PerformanceObserverInit);
    sink.capability({ name: type, status: 'active' });
    stops.push(() => {
      for (const entry of observer.takeRecords() as TimedEntry[]) {
        capture(entry);
      }
      observer.disconnect();
    });
  } catch (error) {
    observer.disconnect();
    sink.capability({ name: type, reason: String(error), status: 'error' });
  }
}

function startMemorySampling(
  origin: number,
  mode: NonNullable<TraceBrowserCaptureOptions['memory']>,
  intervalMs: number,
  sink: BrowserSignalSink,
  emit: Emit,
  stops: (() => void)[],
): void {
  if (mode === 'off' || typeof performance === 'undefined') {
    sink.capability({
      name: 'memory',
      status: mode === 'off' ? 'disabled' : 'unsupported',
    });
    return;
  }
  const browserPerformance = performance as HeapPerformance;
  const source = memorySource(mode, browserPerformance);
  if (!source) {
    sink.capability({ name: 'memory', status: 'unsupported' });
    return;
  }
  sink.capability({
    name: 'memory',
    reason:
      source === 'heap'
        ? 'Chromium non-standard JS heap estimate'
        : 'User-agent total estimate',
    status: 'active',
  });
  const measure =
    source === 'heap'
      ? createHeapMemoryMeasure(browserPerformance, emit)
      : createUaMemoryMeasure(origin, browserPerformance, sink, emit);
  measure();
  const timer = globalThis.setInterval(
    measure,
    source === 'ua' ? Math.max(intervalMs, 5_000) : intervalMs,
  );
  stops.push(() => {
    measure.stop?.();
    globalThis.clearInterval(timer);
  });
}

function createHeapMemoryMeasure(
  browserPerformance: HeapPerformance,
  emit: Emit,
): (() => void) & { stop: () => void } {
  const measure = () => {
    const bytes = browserPerformance.memory?.usedJSHeapSize;
    if (typeof bytes === 'number') {
      emit('memory.js-heap-used', bytes, 'bytes', 'performance.memory');
    }
  };
  measure.stop = () => undefined;
  return measure;
}

function memorySource(
  mode: NonNullable<TraceBrowserCaptureOptions['memory']>,
  browserPerformance: HeapPerformance,
): 'heap' | 'ua' | undefined {
  const heap = typeof browserPerformance.memory?.usedJSHeapSize === 'number';
  const ua =
    typeof browserPerformance.measureUserAgentSpecificMemory === 'function' &&
    globalThis.crossOriginIsolated === true;
  if (mode === 'heap') {
    return heap ? 'heap' : undefined;
  }
  if (mode === 'ua') {
    return ua ? 'ua' : undefined;
  }
  return heap ? 'heap' : ua ? 'ua' : undefined;
}

function createUaMemoryMeasure(
  origin: number,
  browserPerformance: HeapPerformance,
  sink: BrowserSignalSink,
  emit: Emit,
): (() => void) & { stop: () => void } {
  let active = true;
  let pending = false;
  const measure = () => {
    if (pending) {
      return;
    }
    pending = true;
    void browserPerformance
      .measureUserAgentSpecificMemory?.()
      .then(({ bytes }) => {
        if (active) {
          emit(
            'memory.ua-total',
            bytes,
            'bytes',
            'measureUserAgentSpecificMemory',
            performance.now() - origin,
          );
        }
      })
      .catch(() => {
        sink.capability({
          name: 'memory',
          reason: 'Measurement failed or permission denied',
          status: 'error',
        });
      })
      .finally(() => {
        pending = false;
      });
  };
  measure.stop = () => {
    active = false;
  };
  return measure;
}

function startTimerLag(
  enabled: boolean,
  intervalMs: number,
  sink: BrowserSignalSink,
  emit: Emit,
  stops: (() => void)[],
): void {
  if (!enabled) {
    sink.capability({ name: 'timer-lag', status: 'disabled' });
    return;
  }
  let expected = performance.now() + intervalMs;
  const timer = globalThis.setInterval(() => {
    const current = performance.now();
    emit('timer.lag', Math.max(0, current - expected), 'ms', 'interval-drift');
    expected = current + intervalMs;
  }, intervalMs);
  sink.capability({ name: 'timer-lag', status: 'active' });
  stops.push(() => globalThis.clearInterval(timer));
}

function startFrameRate(
  enabled: boolean,
  intervalMs: number,
  sink: BrowserSignalSink,
  emit: Emit,
  stops: (() => void)[],
): void {
  if (!enabled || typeof requestAnimationFrame === 'undefined') {
    sink.capability({
      name: 'frame-rate',
      status: enabled ? 'unsupported' : 'disabled',
    });
    return;
  }
  let active = true;
  let frames = 0;
  let windowStart = performance.now();
  let requestId = 0;
  const tick = (time: number) => {
    if (!active) {
      return;
    }
    frames += 1;
    const elapsed = time - windowStart;
    if (elapsed >= intervalMs) {
      emit(
        'frame.fps',
        (frames * 1_000) / elapsed,
        'fps',
        'requestAnimationFrame',
      );
      frames = 0;
      windowStart = time;
    }
    requestId = requestAnimationFrame(tick);
  };
  requestId = requestAnimationFrame(tick);
  sink.capability({ name: 'frame-rate', status: 'active' });
  stops.push(() => {
    active = false;
    cancelAnimationFrame(requestId);
  });
}

function startVisibility(
  enabled: boolean,
  sink: BrowserSignalSink,
  emit: Emit,
  stops: (() => void)[],
): void {
  if (!enabled || typeof document === 'undefined') {
    sink.capability({
      name: 'visibility',
      status: enabled ? 'unsupported' : 'disabled',
    });
    return;
  }
  const capture = () =>
    emit(
      'page.visibility',
      document.visibilityState === 'visible' ? 1 : 0,
      'state',
      'page-visibility',
      undefined,
      { state: document.visibilityState },
    );
  capture();
  document.addEventListener('visibilitychange', capture);
  sink.capability({ name: 'visibility', status: 'active' });
  stops.push(() => document.removeEventListener('visibilitychange', capture));
}

function startCpuPressure(
  origin: number,
  enabled: boolean,
  intervalMs: number,
  sink: BrowserSignalSink,
  emit: Emit,
  stops: (() => void)[],
): void {
  if (!enabled) {
    sink.capability({ name: 'cpu-pressure', status: 'disabled' });
    return;
  }
  const Constructor = (
    globalThis as typeof globalThis & {
      PressureObserver?: new (
        callback: (records: PressureRecord[]) => void,
      ) => PressureObserverLike;
    }
  ).PressureObserver;
  if (!Constructor || !globalThis.isSecureContext) {
    sink.capability({ name: 'cpu-pressure', status: 'unsupported' });
    return;
  }
  const observer = new Constructor((records) => {
    for (const record of records) {
      emit(
        'cpu.pressure',
        PRESSURE_LEVEL[record.state],
        'level',
        'compute-pressure',
        record.time - origin,
        { state: record.state },
      );
    }
  });
  stops.push(() => observer.disconnect());
  void observer
    .observe('cpu', { sampleInterval: Math.max(intervalMs, 1_000) })
    .then(() => {
      sink.capability({ name: 'cpu-pressure', status: 'active' });
    })
    .catch((error) => {
      observer.disconnect();
      sink.capability({
        name: 'cpu-pressure',
        reason: String(error),
        status: 'error',
      });
    });
}
