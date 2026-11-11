// Adapted from the core runtime in sx-tracing. Instrumented methods use their
// original implementations outside an active recording.

import { startBrowserSignals } from './browserSignals';
import { snapshotTraceError } from './errorSnapshot';

export type TraceEventKind = 'call' | 'marker';

export interface TraceEvent<TData = unknown> {
  arguments?: unknown[];
  at: number;
  data?: TData;
  duration?: number;
  error?: unknown;
  id: number;
  kind: TraceEventKind;
  memory?: TraceMemorySample;
  name: string;
  namespace?: string;
  parent?: number;
  ray: string;
  status?: 'error' | 'ok';
}

export interface TraceMemorySample {
  deltaBytes: number;
  endBytes: number;
  startBytes: number;
}

export interface TraceRecordingOptions {
  browser?: TraceBrowserCaptureOptions;
  /** Disable stack-based links across await boundaries for lower-overhead full captures. */
  captureAsyncContext?: boolean;
  cpu?: boolean;
  lightWindowMs?: number;
  maxFunctionsPerWindow?: number;
  maxLightWindows?: number;
  memory?: boolean;
  methods?: string[];
  mode?: TraceRecordingMode;
  withArguments?: boolean;
}

export type TraceRecordingMode = 'browser' | 'full' | 'light';

export interface TraceBrowserCaptureOptions {
  cpuPressure?: boolean;
  eventTiming?: boolean;
  frameRate?: boolean;
  layoutShifts?: boolean;
  maxSamples?: number;
  memory?: 'auto' | 'heap' | 'off' | 'ua';
  resourceMinDurationMs?: number;
  resources?: boolean;
  sampleIntervalMs?: number;
  timerLag?: boolean;
  visibility?: boolean;
}

export type TraceBrowserMetric =
  | 'cpu.pressure'
  | 'event.duration'
  | 'event.input-delay'
  | 'event.processing'
  | 'frame.fps'
  | 'layout.shift'
  | 'memory.js-heap-used'
  | 'memory.ua-total'
  | 'page.visibility'
  | 'resource.duration'
  | 'resource.transfer-size'
  | 'timer.lag';

export interface TraceBrowserSample {
  at: number;
  detail?: Record<string, number | string>;
  metric: TraceBrowserMetric;
  source: string;
  unit: 'bytes' | 'fps' | 'level' | 'ms' | 'score' | 'state';
  value: number;
}

export interface TraceCaptureCapability {
  name: string;
  reason?: string;
  status: 'active' | 'disabled' | 'error' | 'unsupported';
}

export interface TraceFunctionWindow {
  at: number;
  functions: TraceFunctionWindowStat[];
  otherCalls: number;
  otherDuration: number;
  span: number;
}

export interface TraceFunctionWindowStat {
  calls: number;
  errors: number;
  maxDuration: number;
  name: string;
  namespace: string;
  totalDuration: number;
}

export interface TraceFunctionAggregate {
  argumentExample?: unknown[];
  calls: number;
  errors: number;
  maxDuration: number;
  memoryDeltaBytes?: number;
  memorySamples?: number;
  minDuration: number;
  name: string;
  namespace: string;
  totalDuration: number;
}

export interface TraceRecordingState {
  browserCapabilities?: TraceCaptureCapability[];
  cpuSource?: TraceCpuSource;
  eventCount: number;
  isRecording: boolean;
  mode?: TraceRecordingMode;
  sessionId?: string;
  startedAt?: string;
  timelineOrigin?: number;
  traceCount: number;
}

export interface TraceRecording {
  aggregates?: TraceFunctionAggregate[];
  browserCapabilities?: TraceCaptureCapability[];
  browserSamples?: TraceBrowserSample[];
  cpuSamples?: TraceCpuSample[];
  cpuSource?: TraceCpuSource;
  droppedBrowserSamples?: number;
  droppedFunctionWindows?: number;
  duration: number;
  extensionSamples?: TraceExtensionSample[];
  functionWindows?: TraceFunctionWindow[];
  mode?: TraceRecordingMode;
  releasedAt: string;
  schemaVersion: 1;
  sessionId: string;
  startedAt: string;
  status?: 'complete' | 'recording';
  timelineOrigin?: number;
  title?: string;
  traces: {
    events: TraceEvent[];
    metadata?: Record<string, unknown>;
    ray: string;
  }[];
}

export interface TraceExtensionSample<TData = unknown> {
  at: number;
  channel: string;
  data: TData;
}

export type TraceCpuSource =
  | 'long-animation-frame'
  | 'long-task'
  | 'unavailable';

export interface TraceCpuSample {
  at: number;
  blockingDuration: number;
  duration: number;
  firstUiEventAt?: number;
  renderAt?: number;
  scripts?: TraceCpuScriptAttribution[];
  source: Exclude<TraceCpuSource, 'unavailable'>;
  styleAndLayoutAt?: number;
}

export interface TraceCpuScriptAttribution {
  duration: number;
  forcedStyleAndLayoutDuration?: number;
  functionName?: string;
  invoker?: string;
  sourceUrl?: string;
}

export type TraceRecordingUpdate =
  | {
      event: TraceEvent;
      sessionId: string;
      type: 'event';
    }
  | {
      sample: TraceBrowserSample;
      sessionId: string;
      type: 'browser-sample';
    }
  | {
      sample: TraceCpuSample;
      sessionId: string;
      type: 'cpu-sample';
    }
  | {
      sample: TraceExtensionSample;
      sessionId: string;
      type: 'extension-sample';
    };

type TraceRecordingUpdateListener = (update: TraceRecordingUpdate) => void;

interface EventExtras {
  arguments?: unknown[];
  data?: unknown;
  duration?: number;
  error?: unknown;
  memory?: TraceMemorySample;
  status?: 'error' | 'ok';
}

interface TraceHeap {
  ats: number[];
  extras?: Map<number, EventExtras>;
  kinds: number[];
  metadata?: Record<string, unknown>;
  names: string[];
  namespaces: string[];
  parents: number[];
  ray: string;
  sessionId?: string;
  timelineOrigin: number;
}

interface RecordingSession {
  aggregateCalls: number;
  aggregates: Map<string, TraceFunctionAggregate>;
  browserCapabilities: TraceCaptureCapability[];
  browserSamples: TraceBrowserSample[];
  browserStop?: () => void;
  captureArguments: boolean;
  captureAsyncContext: boolean;
  captureMemory: boolean;
  cpuObserver?: PerformanceObserver;
  cpuSamples?: TraceCpuSample[];
  cpuSource?: TraceCpuSource;
  draining?: boolean;
  droppedBrowserSamples: number;
  droppedFunctionWindows: number;
  eventCount: number;
  extensionSamples: TraceExtensionSample[];
  heaps: Set<TraceHeap>;
  id: string;
  lightWindowMs: number;
  lightWindows: Map<number, LightWindowAccumulator>;
  maxBrowserSamples: number;
  maxFunctionsPerWindow: number;
  maxLightWindows: number;
  methods?: MethodFilter;
  mode: TraceRecordingMode;
  releaseCutoff?: number;
  startedAt: string;
  startedAtMonotonic: number;
}

interface LightWindowAccumulator {
  functions: Map<string, TraceFunctionWindowStat>;
  otherCalls: number;
  otherDuration: number;
}

interface AsyncSlotInfo {
  eventId: number;
  heap: TraceHeap;
  name: string;
  namespace: string;
}

type AnyFunction = (...args: any[]) => any;
type AnyConstructor = abstract new (...args: any[]) => any;
type AsyncSlot = <T>(
  value: PromiseLike<T>,
  slot: number,
  heap: TraceHeap,
) => Promise<T>;

const KIND_CALL = 0;
const KIND_MARKER = 1;
const FRAME_PREFIX = '__editor_platform_trace__';
const FRAME_RE = /__editor_platform_trace__(\d+)/;
const GLOBAL_STATE_KEY = '__EDITOR_PLATFORM_TRACING__';
const ASYNC_POOL_INITIAL = 64;
const ARGUMENT_MAX_COLLECTION_SIZE = 40;
const ARGUMENT_MAX_DEPTH = 4;
const ARGUMENT_MAX_NODES = 500;
const ARGUMENT_MAX_STRING_LENGTH = 2_000;
const DEFAULT_NAMESPACE = 'editor-platform';
const DEFAULT_LIGHT_WINDOW_MS = 1_000;
const DEFAULT_MAX_FUNCTIONS_PER_WINDOW = 80;
const DEFAULT_MAX_LIGHT_WINDOWS = 1_800;
const DEFAULT_MAX_BROWSER_SAMPLES = 20_000;

const heaps = new Map<string, TraceHeap>();
const pendingAsyncHeaps = new Map<TraceHeap, number>();
const asyncPool: AsyncSlot[] = [];
const asyncSlotInfo = new Map<number, AsyncSlotInfo>();
const slotsInFlight = new Set<number>();

let recordingSession: RecordingSession | undefined;
let tracingSuspensionDepth = 0;
let currentScope: TraceHeap | undefined;
let asyncSlotCursor = 0;
let nextRay = 0;
let activeDepth = 0;
const activeHeaps: TraceHeap[] = [];
const activeNames: string[] = [];
const activeNamespaces: string[] = [];
const activeEventIds: (number | undefined)[] = [];
const decoratedFunctions = new WeakSet<AnyFunction>();
const traceIgnoredFunctions = new WeakSet<AnyFunction>();
const traceArgumentSnapshotDisabledFunctions = new WeakSet<AnyFunction>();
const recordingUpdateListeners = new Set<TraceRecordingUpdateListener>();
interface TraceTarget {
  captureArguments?: boolean;
  key: PropertyKey;
  name: string;
  namespace: string;
  target: object;
}

interface ActiveTraceTarget {
  installed: PropertyDescriptor;
  key: PropertyKey;
  original?: PropertyDescriptor;
  target: object;
}

const traceTargets = new Set<TraceTarget>();
const traceTargetKeys = new WeakMap<object, Set<PropertyKey>>();
const activeTraceTargets: ActiveTraceTarget[] = [];

function now(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function createId(prefix: string): string {
  nextRay += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextRay.toString(36)}`;
}

function setGlobalState(state: TraceRecordingState): void {
  Object.defineProperty(globalThis, GLOBAL_STATE_KEY, {
    configurable: true,
    enumerable: false,
    value: Object.freeze({ ...state }),
    writable: false,
  });
}

function currentEventCount(session: RecordingSession): number {
  if (session.mode === 'light') {
    return session.aggregateCalls;
  }
  return session.eventCount;
}

export function getRecordingState(): TraceRecordingState {
  if (!recordingSession) {
    return {
      eventCount: 0,
      isRecording: false,
      traceCount: 0,
    };
  }

  return {
    browserCapabilities: recordingSession.browserCapabilities,
    cpuSource: recordingSession.cpuSource,
    eventCount: currentEventCount(recordingSession),
    isRecording: true,
    mode: recordingSession.mode,
    sessionId: recordingSession.id,
    startedAt: recordingSession.startedAt,
    timelineOrigin: recordingSession.startedAtMonotonic,
    traceCount: recordingSession.heaps.size,
  };
}

export function isRecordingActive(): boolean {
  return recordingSession !== undefined;
}

/**
 * A participant that contributes side-channel data to whichever recording is
 * active. Collectors exist so that layers outside this package (Platform cache
 * sampling, and anything an integrating repository adds) can take part in a
 * recording without replacing the recorder's own entry points. Every collector
 * runs for every recording, whether it was started through a direct import or
 * through `globalThis.__EDITOR_TRACING__`.
 */
export interface TraceCollector {
  /** Add derived fields to the released recording. Runs in registration order. */
  decorate?: (recording: TraceRecording) => TraceRecording;
  /** Stable identifier. Registering the same name again replaces the previous collector. */
  name: string;
  /** Runs once capture has started. */
  onStart?: (
    state: TraceRecordingState,
    options: TraceRecordingOptions,
  ) => void;
  /** Runs while the session is still active, before the recording is assembled. */
  onStop?: () => void;
}

const traceCollectors = new Map<string, TraceCollector>();

// Cleared per recording: the answer depends on that session's filter.
const methodFilterMatches = new Map<string, boolean>();

export function registerTraceCollector(collector: TraceCollector): () => void {
  traceCollectors.set(collector.name, collector);
  return () => {
    if (traceCollectors.get(collector.name) === collector) {
      traceCollectors.delete(collector.name);
    }
  };
}

// A failing collector must not take the recording down with it. While a session
// is active the failure is recorded as data on a reserved channel, so it stays
// visible in the dashboard instead of disappearing into the console.
function runCollectors(
  hook: 'onStart' | 'onStop',
  run: (collector: TraceCollector) => void,
): void {
  for (const collector of traceCollectors.values()) {
    try {
      run(collector);
    } catch (error) {
      addTraceExtensionSample('tracing.collector-error', {
        collector: collector.name,
        error: snapshotTraceError(error),
        hook,
      });
    }
  }
}

function decorateRecording(recording: TraceRecording): TraceRecording {
  let decorated = recording;
  for (const collector of traceCollectors.values()) {
    try {
      decorated = collector.decorate?.(decorated) ?? decorated;
    } catch (error) {
      // Keep the undecorated recording rather than losing the capture, and
      // report the failure the same way onStart and onStop failures are
      // reported. The session is already closed by this point, so the sample
      // is appended to the recording instead of going through
      // addTraceExtensionSample.
      decorated = {
        ...decorated,
        extensionSamples: [
          ...(decorated.extensionSamples ?? []),
          {
            at: decorated.duration,
            channel: 'tracing.collector-error',
            data: {
              collector: collector.name,
              error: snapshotTraceError(error),
              hook: 'decorate',
            },
          },
        ],
      };
    }
  }
  return decorated;
}

/**
 * Browser mode never installs method wrappers, so it is the one capture still
 * meaningful without them. Any other mode would hand back a recording with no
 * calls in it, which reads as "the code ran nothing" rather than "tracing was
 * not installed".
 */
function assertTracingInstalled(mode: TraceRecordingMode): void {
  if (isTracingRequested() || mode === 'browser') {
    return;
  }
  throw new Error(
    'Tracing is not installed on this page, so a recording would contain no ' +
      'calls. Reload with the `install-tracing` query parameter, for example ' +
      '?install-tracing, and start the recording again. Browser-signal ' +
      "captures work without it: pass { mode: 'browser' }.",
  );
}

export function startRecording(
  options: TraceRecordingOptions = {},
): TraceRecordingState {
  assertTracingInstalled(options.mode ?? 'full');
  methodFilterMatches.clear();
  const started = !recordingSession;
  if (!recordingSession) {
    const startedAtMonotonic = now();
    const session: RecordingSession = {
      aggregateCalls: 0,
      aggregates: new Map(),
      browserCapabilities: [],
      browserSamples: [],
      captureArguments: options.withArguments === true,
      captureAsyncContext: options.captureAsyncContext !== false,
      captureMemory: options.memory === true,
      droppedBrowserSamples: 0,
      droppedFunctionWindows: 0,
      eventCount: 0,
      extensionSamples: [],
      heaps: new Set(),
      id: createId('session'),
      lightWindowMs: clamp(
        options.lightWindowMs,
        250,
        10_000,
        DEFAULT_LIGHT_WINDOW_MS,
      ),
      lightWindows: new Map(),
      maxBrowserSamples: clamp(
        options.browser?.maxSamples,
        100,
        100_000,
        DEFAULT_MAX_BROWSER_SAMPLES,
      ),
      maxFunctionsPerWindow: clamp(
        options.maxFunctionsPerWindow,
        10,
        500,
        DEFAULT_MAX_FUNCTIONS_PER_WINDOW,
      ),
      maxLightWindows: clamp(
        options.maxLightWindows,
        60,
        3_600,
        DEFAULT_MAX_LIGHT_WINDOWS,
      ),
      methods: normalizeMethods(options.methods),
      mode: options.mode ?? 'full',
      startedAt: new Date().toISOString(),
      startedAtMonotonic,
    };
    recordingSession = session;
    if (!session.captureAsyncContext) {
      addTraceExtensionSample('tracing.configuration', {
        captureAsyncContext: false,
      });
    }
    if (session.mode !== 'browser') {
      enableTraceTargets();
    }
    startCpuMonitoring(session, options.cpu !== false);
    session.browserStop = startBrowserSignals(
      startedAtMonotonic,
      options.browser ?? {},
      {
        capability: (capability) => setBrowserCapability(session, capability),
        sample: (sample) => captureBrowserSample(session, sample),
      },
    );
  }

  const state = getRecordingState();
  setGlobalState(state);
  if (started) {
    runCollectors('onStart', (collector) =>
      collector.onStart?.(state, options),
    );
  }
  return state;
}

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.min(max, Math.max(min, value ?? fallback));
}

function setBrowserCapability(
  session: RecordingSession,
  capability: TraceCaptureCapability,
): void {
  const index = session.browserCapabilities.findIndex(
    ({ name }) => name === capability.name,
  );
  if (index >= 0) {
    session.browserCapabilities[index] = capability;
  } else {
    session.browserCapabilities.push(capability);
  }
}

function captureBrowserSample(
  session: RecordingSession,
  sample: TraceBrowserSample,
): void {
  if (
    (recordingSession !== session && !session.draining) ||
    (session.releaseCutoff !== undefined && sample.at > session.releaseCutoff)
  ) {
    return;
  }
  if (session.browserSamples.length >= session.maxBrowserSamples) {
    session.droppedBrowserSamples += 1;
    return;
  }
  session.browserSamples.push(sample);
  publishRecordingUpdate({
    sample,
    sessionId: session.id,
    type: 'browser-sample',
  });
}

/**
 * An entry containing a dot is a path and is matched on segment boundaries; a
 * bare entry is a search term and is matched anywhere in the function name.
 */
interface MethodFilter {
  /** Dotted entries, matched against segment-aligned suffixes of the identity. */
  paths: Set<string>;
  /** Bare entries, matched as substrings of the name. */
  search: string[];
}

function normalizeMethods(
  methods: string[] | undefined,
): MethodFilter | undefined {
  const normalized = methods
    ?.map((method) => method.trim())
    .filter((method) => method.length > 0);
  if (!normalized?.length) {
    return undefined;
  }
  return {
    paths: new Set(normalized.filter((entry) => entry.includes('.'))),
    search: normalized.filter((entry) => !entry.includes('.')),
  };
}

export function addTraceExtensionSample<TData>(
  channel: string,
  data: TData,
): void {
  const session = recordingSession;
  if (!session || session.mode === 'browser') {
    return;
  }
  const sample: TraceExtensionSample<TData> = {
    at: now() - session.startedAtMonotonic,
    channel,
    data,
  };
  session.extensionSamples.push(sample);
  publishRecordingUpdate({
    sample,
    sessionId: session.id,
    type: 'extension-sample',
  });
}

/** A recording-scoped reference safe to retain across await boundaries. */
export interface TraceRayHandle {
  readonly ray: string;
  readonly sessionId: string;
}

export function getActiveTraceRay(): TraceRayHandle | undefined {
  const heap = activeDepth > 0 ? activeHeaps[activeDepth - 1] : undefined;
  if (!recordingSession || !heap || recordingSession.mode === 'light') {
    return undefined;
  }
  return { ray: heap.ray, sessionId: recordingSession.id };
}

/** Replace one owner's JSON metadata. Returns false if this ray is unavailable. */
export function setTraceRayMetadata(
  owner: string,
  data: unknown,
  handle = getActiveTraceRay(),
): boolean {
  if (!handle || handle.sessionId !== recordingSession?.id) {
    return false;
  }
  const heap = heaps.get(handle.ray);
  if (!heap || heap.sessionId !== handle.sessionId) {
    return false;
  }
  const snapshot = snapshotRayMetadata(owner, data);
  const metadata =
    heap.metadata ?? (Object.create(null) as Record<string, unknown>);
  if (!Object.hasOwn(metadata, owner) && Object.keys(metadata).length >= 32) {
    throw new Error('A ray supports at most 32 metadata owners');
  }
  Object.defineProperty(metadata, owner, {
    configurable: true,
    enumerable: true,
    value: snapshot,
    writable: true,
  });
  heap.metadata = metadata;
  addTraceExtensionSample('tracing.ray-metadata', {
    owner,
    ray: heap.ray,
    value: snapshot,
  });
  return true;
}

function snapshotRayMetadata(owner: string, data: unknown): unknown {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(owner)) {
    throw new Error(
      'Metadata owner must be a namespaced identifier (1–128 characters)',
    );
  }
  const encoded = JSON.stringify(data);
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).length > 16384
  ) {
    throw new Error(
      'Ray metadata must be JSON serializable and at most 16 KiB per owner',
    );
  }
  return JSON.parse(encoded);
}

export function withTracingSuspended<T>(fn: () => T): T {
  tracingSuspensionDepth += 1;
  try {
    return fn();
  } finally {
    tracingSuspensionDepth -= 1;
  }
}

export function subscribeRecordingUpdates(
  listener: TraceRecordingUpdateListener,
): () => void {
  recordingUpdateListeners.add(listener);
  return () => recordingUpdateListeners.delete(listener);
}

export function getCompletedRecordingUpdates(): TraceRecordingUpdate[] {
  const session = recordingSession;
  if (!session) {
    return [];
  }
  return [
    ...session.browserSamples.map((sample): TraceRecordingUpdate => ({
      sample,
      sessionId: session.id,
      type: 'browser-sample',
    })),
    ...session.extensionSamples.map((sample): TraceRecordingUpdate => ({
      sample,
      sessionId: session.id,
      type: 'extension-sample',
    })),
    ...(session.cpuSamples ?? []).map((sample): TraceRecordingUpdate => ({
      sample,
      sessionId: session.id,
      type: 'cpu-sample',
    })),
    ...[...session.heaps].flatMap((heap) =>
      synthesizeEvents(heap)
        .filter(
          (event) => event.kind === 'marker' || event.status !== undefined,
        )
        .map((event): TraceRecordingUpdate => ({
          event,
          sessionId: session.id,
          type: 'event',
        })),
    ),
  ];
}

interface CpuPerformanceEntry extends PerformanceEntry {
  blockingDuration?: number;
  firstUIEventTimestamp?: number;
  renderStart?: number;
  scripts?: CpuScriptTiming[];
  styleAndLayoutStart?: number;
}

interface CpuScriptTiming {
  duration?: number;
  forcedStyleAndLayoutDuration?: number;
  invoker?: string;
  sourceFunctionName?: string;
  sourceURL?: string;
}

function startCpuMonitoring(session: RecordingSession, enabled: boolean): void {
  if (!enabled) {
    return;
  }
  session.cpuSamples = [];
  if (typeof PerformanceObserver === 'undefined') {
    session.cpuSource = 'unavailable';
    return;
  }
  const supported = PerformanceObserver.supportedEntryTypes ?? [];
  const source: Exclude<TraceCpuSource, 'unavailable'> | undefined =
    supported.includes('long-animation-frame')
      ? 'long-animation-frame'
      : supported.includes('longtask')
        ? 'long-task'
        : undefined;
  if (!source) {
    session.cpuSource = 'unavailable';
    return;
  }
  session.cpuSource = source;
  session.cpuObserver = new PerformanceObserver((list) => {
    captureCpuEntries(session, source, list.getEntries());
  });
  try {
    session.cpuObserver.observe({
      buffered: false,
      type: source === 'long-task' ? 'longtask' : source,
    } as PerformanceObserverInit);
  } catch {
    session.cpuObserver.disconnect();
    session.cpuObserver = undefined;
    session.cpuSource = 'unavailable';
  }
}

function captureCpuEntries(
  session: RecordingSession,
  source: Exclude<TraceCpuSource, 'unavailable'>,
  entries: PerformanceEntryList,
): void {
  if (recordingSession !== session && !session.draining) {
    return;
  }
  for (const entry of entries as CpuPerformanceEntry[]) {
    const at = Math.max(0, entry.startTime - session.startedAtMonotonic);
    if (session.releaseCutoff !== undefined && at > session.releaseCutoff) {
      continue;
    }
    const sample: TraceCpuSample = {
      at,
      blockingDuration:
        source === 'long-animation-frame'
          ? Math.max(0, entry.blockingDuration ?? entry.duration - 50)
          : entry.duration,
      duration: entry.duration,
      firstUiEventAt: relativeEntryTime(
        entry.firstUIEventTimestamp,
        session.startedAtMonotonic,
      ),
      renderAt: relativeEntryTime(
        entry.renderStart,
        session.startedAtMonotonic,
      ),
      scripts:
        source === 'long-animation-frame'
          ? getCpuScriptAttribution(entry.scripts)
          : undefined,
      source,
      styleAndLayoutAt: relativeEntryTime(
        entry.styleAndLayoutStart,
        session.startedAtMonotonic,
      ),
    };
    session.cpuSamples?.push(sample);
    publishRecordingUpdate({
      sample,
      sessionId: session.id,
      type: 'cpu-sample',
    });
  }
}

function relativeEntryTime(
  value: number | undefined,
  origin: number,
): number | undefined {
  return value && value > 0 ? value - origin : undefined;
}

function getCpuScriptAttribution(
  scripts: CpuScriptTiming[] | undefined,
): TraceCpuScriptAttribution[] | undefined {
  const attribution = scripts
    ?.map((script) => ({
      duration: script.duration ?? 0,
      forcedStyleAndLayoutDuration:
        script.forcedStyleAndLayoutDuration || undefined,
      functionName: script.sourceFunctionName || undefined,
      invoker: script.invoker || undefined,
      sourceUrl: sanitizeScriptUrl(script.sourceURL),
    }))
    .filter(({ duration }) => duration > 0)
    .sort((left, right) => right.duration - left.duration)
    .slice(0, 10);
  return attribution?.length ? attribution : undefined;
}

function sanitizeScriptUrl(sourceUrl: string | undefined): string | undefined {
  if (!sourceUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(sourceUrl, globalThis.location?.href);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 1_000);
  } catch {
    return sourceUrl.split(/[?#]/, 1)[0]?.slice(0, 1_000);
  }
}

function publishRecordingUpdate(update: TraceRecordingUpdate): void {
  for (const listener of recordingUpdateListeners) {
    listener(update);
  }
}

function createHeap(): TraceHeap {
  const heap: TraceHeap = {
    ats: [],
    kinds: [],
    names: [],
    namespaces: [],
    parents: [],
    ray: createId('trace'),
    sessionId: recordingSession?.id,
    timelineOrigin: recordingSession?.startedAtMonotonic ?? 0,
  };
  heaps.set(heap.ray, heap);
  recordingSession?.heaps.add(heap);
  return heap;
}

function ensureExtras(heap: TraceHeap, id: number): EventExtras {
  heap.extras ??= new Map();
  let extras = heap.extras.get(id);
  if (!extras) {
    extras = {};
    heap.extras.set(id, extras);
  }
  return extras;
}

function pushRecord(
  heap: TraceHeap,
  name: string,
  namespace: string,
  kind: number,
  parent: number,
  at: number,
  data?: unknown,
): number {
  const id = heap.names.length + 1;
  heap.names.push(name);
  heap.namespaces.push(namespace);
  heap.kinds.push(kind);
  heap.parents.push(parent);
  heap.ats.push(Math.max(0, at - heap.timelineOrigin));
  if (recordingSession && heap.sessionId === recordingSession.id) {
    recordingSession.eventCount += 1;
  }
  if (data !== undefined) {
    ensureExtras(heap, id).data = data;
  }
  if (kind === KIND_MARKER && heap.sessionId) {
    publishRecordingUpdate({
      event: synthesizeEvent(heap, id),
      sessionId: heap.sessionId,
      type: 'event',
    });
  }
  return id;
}

function pushActiveFrame(
  heap: TraceHeap,
  name: string,
  namespace: string,
  eventId: number | undefined,
): void {
  activeHeaps[activeDepth] = heap;
  activeNames[activeDepth] = name;
  activeNamespaces[activeDepth] = namespace;
  activeEventIds[activeDepth] = eventId;
  activeDepth += 1;
}

function popActiveFrame(): void {
  activeDepth -= 1;
}

function buildAsyncSlot(slot: number): AsyncSlot {
  const frameName = `${FRAME_PREFIX}${slot}`;
  const holder = {
    async [frameName]<T>(
      value: PromiseLike<T>,
      slotId: number,
      heap: TraceHeap,
    ): Promise<T> {
      try {
        return await value;
      } finally {
        slotsInFlight.delete(slotId);
        asyncSlotInfo.delete(slotId);
        const count = (pendingAsyncHeaps.get(heap) ?? 1) - 1;
        if (count > 0) {
          pendingAsyncHeaps.set(heap, count);
        } else {
          pendingAsyncHeaps.delete(heap);
        }
      }
    },
  };
  return holder[frameName] as AsyncSlot;
}

for (let slot = 0; slot < ASYNC_POOL_INITIAL; slot += 1) {
  asyncPool.push(buildAsyncSlot(slot));
}

function takeAsyncSlot(
  heap: TraceHeap,
  name: string,
  namespace: string,
  eventId: number,
): number {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _slot of asyncPool) {
    const slot = asyncSlotCursor;
    asyncSlotCursor = (asyncSlotCursor + 1) % asyncPool.length;
    if (!slotsInFlight.has(slot)) {
      slotsInFlight.add(slot);
      asyncSlotInfo.set(slot, { eventId, heap, name, namespace });
      return slot;
    }
  }

  const slot = asyncPool.length;
  asyncPool.push(buildAsyncSlot(slot));
  slotsInFlight.add(slot);
  asyncSlotInfo.set(slot, { eventId, heap, name, namespace });
  return slot;
}

function keepAsyncStackFrame<T>(
  name: string,
  namespace: string,
  heap: TraceHeap,
  eventId: number,
  value: T,
): T {
  if (
    !value ||
    typeof (value as unknown as PromiseLike<unknown>).then !== 'function'
  ) {
    return value;
  }

  if (recordingSession?.captureAsyncContext === false) {
    return value;
  }
  pendingAsyncHeaps.set(heap, (pendingAsyncHeaps.get(heap) ?? 0) + 1);
  const slot = takeAsyncSlot(heap, name, namespace, eventId);
  return asyncPool[slot]!(
    value as unknown as PromiseLike<Awaited<T>>,
    slot,
    heap,
  ) as T;
}

function frameFromStack(): AsyncSlotInfo | undefined {
  if (recordingSession?.captureAsyncContext === false) {
    return undefined;
  }
  const match = new Error().stack?.match(FRAME_RE);
  return match ? asyncSlotInfo.get(Number.parseInt(match[1]!, 10)) : undefined;
}

function normalizeError(error: unknown): unknown {
  return snapshotTraceError(error);
}

interface ArgumentSnapshotState {
  nodes: number;
  seen: WeakSet<object>;
}

function snapshotArguments(args: unknown[]): unknown[] {
  const state: ArgumentSnapshotState = {
    nodes: 0,
    seen: new WeakSet(),
  };
  return args.map((value) => snapshotArgumentValue(value, 0, state));
}

function snapshotArgumentValue(
  value: unknown,
  depth: number,
  state: ArgumentSnapshotState,
): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isNaN(value) ? '[NaN]' : value;
  }
  if (typeof value === 'string') {
    return value.length > ARGUMENT_MAX_STRING_LENGTH
      ? `${value.slice(0, ARGUMENT_MAX_STRING_LENGTH)}… [truncated]`
      : value;
  }
  if (typeof value !== 'object') {
    return snapshotNonObject(value);
  }
  return snapshotArgumentObject(value, depth, state);
}

function snapshotNonObject(value: unknown): string {
  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`;
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  return '[undefined]';
}

function snapshotArgumentObject(
  value: object,
  depth: number,
  state: ArgumentSnapshotState,
): unknown {
  if (state.seen.has(value)) {
    return '[Circular]';
  }
  if (depth >= ARGUMENT_MAX_DEPTH || state.nodes >= ARGUMENT_MAX_NODES) {
    return `[${objectName(value)} truncated]`;
  }
  state.seen.add(value);
  state.nodes += 1;
  if (value instanceof Error) {
    return normalizeError(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return snapshotArgumentArray(value, depth, state);
  }
  if (value instanceof Map) {
    return snapshotArgumentMap(value, depth, state);
  }
  if (value instanceof Set) {
    return snapshotArgumentSet(value, depth, state);
  }
  return snapshotArgumentRecord(value, depth, state);
}

function snapshotArgumentArray(
  value: unknown[],
  depth: number,
  state: ArgumentSnapshotState,
): unknown[] {
  const result = value
    .slice(0, ARGUMENT_MAX_COLLECTION_SIZE)
    .map((item) => snapshotArgumentValue(item, depth + 1, state));
  if (value.length > ARGUMENT_MAX_COLLECTION_SIZE) {
    result.push(`[${value.length - ARGUMENT_MAX_COLLECTION_SIZE} more items]`);
  }
  return result;
}

function snapshotArgumentMap(
  value: Map<unknown, unknown>,
  depth: number,
  state: ArgumentSnapshotState,
): unknown {
  const entries = [...value.entries()]
    .slice(0, ARGUMENT_MAX_COLLECTION_SIZE)
    .map(([key, item]) => [
      snapshotArgumentValue(key, depth + 1, state),
      snapshotArgumentValue(item, depth + 1, state),
    ]);
  return {
    entries,
    type: 'Map',
    ...(value.size > entries.length
      ? { truncatedEntries: value.size - entries.length }
      : {}),
  };
}

function snapshotArgumentSet(
  value: Set<unknown>,
  depth: number,
  state: ArgumentSnapshotState,
): unknown {
  const values = [...value.values()]
    .slice(0, ARGUMENT_MAX_COLLECTION_SIZE)
    .map((item) => snapshotArgumentValue(item, depth + 1, state));
  return {
    type: 'Set',
    values,
    ...(value.size > values.length
      ? { truncatedValues: value.size - values.length }
      : {}),
  };
}

function snapshotArgumentRecord(
  value: object,
  depth: number,
  state: ArgumentSnapshotState,
): unknown {
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return `[${objectName(value)} could not be inspected]`;
  }
  const entries = Object.entries(descriptors).slice(
    0,
    ARGUMENT_MAX_COLLECTION_SIZE,
  );
  const result: Record<string, unknown> = {};
  for (const [key, descriptor] of entries) {
    result[key] =
      'value' in descriptor
        ? snapshotArgumentValue(descriptor.value, depth + 1, state)
        : '[Getter/Setter]';
  }
  const total = Object.keys(descriptors).length;
  if (total > entries.length) {
    result.__truncatedProperties = total - entries.length;
  }
  return result;
}

function objectName(value: object): string {
  try {
    return value.constructor?.name || 'Object';
  } catch {
    return 'Object';
  }
}

function memoryUsage(): number | undefined {
  if (typeof performance === 'undefined') {
    return undefined;
  }
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    }
  ).memory;
  return typeof memory?.usedJSHeapSize === 'number'
    ? memory.usedJSHeapSize
    : undefined;
}

function finishCall(
  heap: TraceHeap,
  id: number,
  startedAt: number,
  startedMemory: number | undefined,
  status: 'error' | 'ok',
  error?: unknown,
): void {
  if (heap.sessionId && recordingSession?.id !== heap.sessionId) {
    return;
  }
  const extras = ensureExtras(heap, id);
  extras.status = status;
  extras.duration = now() - startedAt;
  const endedMemory = startedMemory === undefined ? undefined : memoryUsage();
  if (startedMemory !== undefined && endedMemory !== undefined) {
    extras.memory = {
      deltaBytes: endedMemory - startedMemory,
      endBytes: endedMemory,
      startBytes: startedMemory,
    };
  }
  if (status === 'error') {
    extras.error = normalizeError(error);
  }
  if (heap.sessionId) {
    publishRecordingUpdate({
      event: synthesizeEvent(heap, id),
      sessionId: heap.sessionId,
      type: 'event',
    });
  }
}

const INSTALL_QUERY_PARAM = 'install-tracing';

let tracingRequested: boolean | undefined;

/**
 * Wrapping costs a call indirection per method for the life of the page, so it
 * is opt-in: the page asks for it with the `install-tracing` query parameter,
 * for example `?metaSiteId=...&install-tracing`.
 *
 * Read through `globalThis` and cached. The recorder also loads on the server
 * and in workers, where there is no `location`; those read as "not requested"
 * rather than throwing. Classes are decorated while modules evaluate, so the
 * answer has to stay stable for the lifetime of the realm.
 */
export function isTracingRequested(): boolean {
  if (tracingRequested === undefined) {
    const search = (globalThis as { location?: { search?: unknown } }).location
      ?.search;
    tracingRequested =
      typeof search === 'string' &&
      new URLSearchParams(search).has(INSTALL_QUERY_PARAM);
  }
  return tracingRequested;
}

export function trace<T extends AnyFunction>(
  fn: T,
  name = fn.name,
  options: { captureArguments?: boolean; namespace?: string } = {},
): T {
  if (!isTracingRequested()) {
    return fn;
  }
  const traceName = name || 'anonymous';
  const namespace = options.namespace ?? DEFAULT_NAMESPACE;

  // The branching is intentionally centralized so the inactive fast path stays
  // a direct call and does not allocate helper objects.
  function traced(
    this: ThisParameterType<T>,
    ...args: Parameters<T>
  ): ReturnType<T> {
    return getGlobalTracing().run(
      namespace,
      traceName,
      fn,
      this,
      args,
      options.captureArguments !== false,
    ) as ReturnType<T>;
  }

  Object.defineProperty(traced, 'name', {
    configurable: true,
    value: traceName,
  });
  Object.defineProperty(traced, Symbol.for('editor-platform.trace.wrapper'), {
    value: true,
  });
  decoratedFunctions.add(traced);
  return traced as T;
}

// eslint-disable-next-line complexity
export function runTracedFunction<T extends AnyFunction>(
  namespace: string,
  name: string,
  fn: T,
  thisArg: ThisParameterType<T>,
  args: Parameters<T>,
  captureArguments = true,
): ReturnType<T> {
  if (
    !isTracingRequested() ||
    tracingSuspensionDepth > 0 ||
    recordingSession?.mode === 'browser'
  ) {
    return fn.apply(thisArg, args);
  }
  if (recordingSession?.mode === 'light') {
    return runAggregatedFunction(
      namespace,
      name,
      fn,
      thisArg,
      args,
      captureArguments,
    );
  }
  const parentIndex = activeDepth - 1;
  const hasAsyncParent = parentIndex < 0 && pendingAsyncHeaps.size > 0;
  if (
    parentIndex < 0 &&
    !currentScope &&
    !hasAsyncParent &&
    !shouldRecordRoot(namespace, name)
  ) {
    return fn.apply(thisArg, args);
  }

  const parentHeap = parentIndex >= 0 ? activeHeaps[parentIndex] : undefined;
  const asyncParent = hasAsyncParent ? frameFromStack() : undefined;
  if (
    parentIndex < 0 &&
    !currentScope &&
    !asyncParent &&
    !shouldRecordRoot(namespace, name)
  ) {
    return fn.apply(thisArg, args);
  }
  const heap = parentHeap ?? currentScope ?? asyncParent?.heap ?? createHeap();
  const parentId =
    parentIndex >= 0 ? activeEventIds[parentIndex] : asyncParent?.eventId;
  const startedAt = now();
  const startedMemory = recordingSession?.captureMemory
    ? memoryUsage()
    : undefined;
  const callId = pushRecord(
    heap,
    name,
    namespace,
    KIND_CALL,
    parentId ?? 0,
    startedAt,
  );
  if (recordingSession?.captureArguments && captureArguments) {
    ensureExtras(heap, callId).arguments = snapshotArguments(args);
  }

  pushActiveFrame(heap, name, namespace, callId);
  let result: ReturnType<T>;
  try {
    result = keepAsyncStackFrame(
      name,
      namespace,
      heap,
      callId,
      fn.apply(thisArg, args),
    ) as ReturnType<T>;
  } catch (error) {
    popActiveFrame();
    finishCall(heap, callId, startedAt, startedMemory, 'error', error);
    throw error;
  }
  popActiveFrame();

  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    return (result as Promise<unknown>).then(
      (value) => {
        finishCall(heap, callId, startedAt, startedMemory, 'ok');
        return value;
      },
      (error: unknown) => {
        finishCall(heap, callId, startedAt, startedMemory, 'error', error);
        throw error;
      },
    ) as ReturnType<T>;
  }

  finishCall(heap, callId, startedAt, startedMemory, 'ok');
  return result;
}

function runAggregatedFunction<T extends AnyFunction>(
  namespace: string,
  name: string,
  fn: T,
  thisArg: ThisParameterType<T>,
  args: Parameters<T>,
  captureArguments: boolean,
): ReturnType<T> {
  const session = recordingSession;
  if (!session || !shouldRecordRoot(namespace, name)) {
    return fn.apply(thisArg, args);
  }
  const startedAt = now();
  const startedMemory = session.captureMemory ? memoryUsage() : undefined;
  const key = `${namespace}\u0000${name}`;
  const argumentExample = snapshotAggregateArguments(
    session,
    key,
    args,
    captureArguments,
  );
  const finish = (failed: boolean): void => {
    if (recordingSession !== session) {
      return;
    }
    const duration = now() - startedAt;
    const aggregate: TraceFunctionAggregate = session.aggregates.get(key) ?? {
      calls: 0,
      errors: 0,
      maxDuration: 0,
      minDuration: Number.POSITIVE_INFINITY,
      name,
      namespace,
      totalDuration: 0,
    };
    aggregate.calls += 1;
    aggregate.errors += Number(failed);
    aggregate.totalDuration += duration;
    aggregate.minDuration = Math.min(aggregate.minDuration, duration);
    aggregate.maxDuration = Math.max(aggregate.maxDuration, duration);
    aggregate.argumentExample ??= argumentExample;
    const endedMemory = startedMemory === undefined ? undefined : memoryUsage();
    if (startedMemory !== undefined && endedMemory !== undefined) {
      aggregate.memoryDeltaBytes =
        (aggregate.memoryDeltaBytes ?? 0) + endedMemory - startedMemory;
      aggregate.memorySamples = (aggregate.memorySamples ?? 0) + 1;
    }
    session.aggregates.set(key, aggregate);
    session.aggregateCalls += 1;
    updateLightWindow(session, namespace, name, startedAt, duration, failed);
  };
  let result: ReturnType<T>;
  try {
    result = fn.apply(thisArg, args);
  } catch (error) {
    finish(true);
    throw error;
  }
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    return (result as Promise<unknown>).then(
      (value) => {
        finish(false);
        return value;
      },
      (error: unknown) => {
        finish(true);
        throw error;
      },
    ) as ReturnType<T>;
  }
  finish(false);
  return result;
}

function updateLightWindow(
  session: RecordingSession,
  namespace: string,
  name: string,
  startedAt: number,
  duration: number,
  failed: boolean,
): void {
  const index = Math.floor(
    (startedAt - session.startedAtMonotonic) / session.lightWindowMs,
  );
  if (index < 0 || index >= session.maxLightWindows) {
    session.droppedFunctionWindows += 1;
    return;
  }
  const window = session.lightWindows.get(index) ?? {
    functions: new Map<string, TraceFunctionWindowStat>(),
    otherCalls: 0,
    otherDuration: 0,
  };
  const key = `${namespace}\u0000${name}`;
  const stat = window.functions.get(key);
  if (!stat && window.functions.size >= session.maxFunctionsPerWindow) {
    window.otherCalls += 1;
    window.otherDuration += duration;
  } else {
    const next = stat ?? {
      calls: 0,
      errors: 0,
      maxDuration: 0,
      name,
      namespace,
      totalDuration: 0,
    };
    next.calls += 1;
    next.errors += Number(failed);
    next.maxDuration = Math.max(next.maxDuration, duration);
    next.totalDuration += duration;
    window.functions.set(key, next);
  }
  session.lightWindows.set(index, window);
}

function snapshotAggregateArguments(
  session: RecordingSession,
  key: string,
  args: unknown[],
  captureArguments: boolean,
): undefined | unknown[] {
  if (
    !session.captureArguments ||
    !captureArguments ||
    session.aggregates.get(key)?.argumentExample
  ) {
    return undefined;
  }
  return snapshotArguments(args);
}

/**
 * Two kinds of entry, told apart by whether the entry contains a dot.
 *
 * A dotted entry is a path and must match exactly, against either the
 * recorded `name` or the full `namespace.name`. Partial paths do not match,
 * because `name` carries however many segments its instrumentation chose --
 * `ManifestQuery.setStyles` from a decorated class, three segments from the
 * composed SDK -- and guessing which of them a partial path meant would make
 * a filter's meaning depend on instrumentation that can change upstream.
 *
 *   editor-platform.SDK.builderComponent.setStyles  matches
 *               SDK.builderComponent.setStyles      matches
 *                   builderComponent.setStyles      does not
 *
 * A bare entry is a search term, matched anywhere in `name`. It is meant for
 * exploring, so `setStyles` deliberately also reaches `setStylesInternal`.
 */
function matchesMethodFilter(
  methods: MethodFilter,
  namespace: string,
  name: string,
): boolean {
  const identity = `${namespace}.${name}`;
  const cached = methodFilterMatches.get(identity);
  if (cached !== undefined) {
    return cached;
  }
  const matched =
    methods.search.some((term) => name.includes(term)) ||
    methods.paths.has(name) ||
    methods.paths.has(identity);
  methodFilterMatches.set(identity, matched);
  return matched;
}

function shouldRecordRoot(namespace: string, name: string): boolean {
  const methods = recordingSession?.methods;
  return (
    recordingSession !== undefined &&
    (!methods || matchesMethodFilter(methods, namespace, name))
  );
}

export function withTrace<T>(name: string, fn: () => T): T {
  if (
    activeDepth === 0 &&
    !recordingSession &&
    !currentScope &&
    pendingAsyncHeaps.size === 0
  ) {
    return fn();
  }

  return trace(fn, name)();
}

export function marker<TData = unknown>(name: string, data?: TData): void {
  const activeIndex = activeDepth - 1;
  if (activeIndex >= 0) {
    const heap = activeHeaps[activeIndex]!;
    pushRecord(
      heap,
      `${activeNames[activeIndex]}.${name}`,
      activeNamespaces[activeIndex]!,
      KIND_MARKER,
      activeEventIds[activeIndex] ?? 0,
      now(),
      data,
    );
    return;
  }

  const asyncParent = pendingAsyncHeaps.size > 0 ? frameFromStack() : undefined;
  if (asyncParent) {
    pushRecord(
      asyncParent.heap,
      `${asyncParent.name}.${name}`,
      asyncParent.namespace,
      KIND_MARKER,
      asyncParent.eventId,
      now(),
      data,
    );
  }
}

export function traceStep<T>(name: string, fn: () => T): T {
  const parentIndex = activeDepth - 1;
  if (parentIndex < 0) {
    return fn();
  }

  const heap = activeHeaps[parentIndex]!;
  const namespace = activeNamespaces[parentIndex]!;
  pushActiveFrame(heap, name, namespace, activeEventIds[parentIndex]);
  try {
    return keepAsyncStackFrame(
      name,
      namespace,
      heap,
      activeEventIds[parentIndex] ?? 0,
      fn(),
    );
  } finally {
    popActiveFrame();
  }
}

function synthesizeEvents(heap: TraceHeap): TraceEvent[] {
  return heap.names
    .map((_, index) => synthesizeEvent(heap, index + 1))
    .sort((left, right) => left.at - right.at);
}

function synthesizeEvent(heap: TraceHeap, id: number): TraceEvent {
  const index = id - 1;
  const extras = heap.extras?.get(id);
  return {
    arguments: extras?.arguments,
    at: heap.ats[index]!,
    data: extras?.data,
    duration: extras?.duration,
    error: extras?.error,
    id,
    kind: heap.kinds[index] === KIND_CALL ? 'call' : 'marker',
    memory: extras?.memory,
    name: heap.names[index]!,
    namespace: heap.namespaces[index]!,
    parent: heap.parents[index] || undefined,
    ray: heap.ray,
    status: extras?.status,
  };
}

function releaseHeap(heap: TraceHeap): void {
  heaps.delete(heap.ray);
  for (const [slot, info] of asyncSlotInfo) {
    if (info.heap === heap && !slotsInFlight.has(slot)) {
      asyncSlotInfo.delete(slot);
    }
  }
}

export function releaseRecording(): TraceRecording {
  const session = recordingSession;
  if (!session) {
    throw new Error('Platform tracing is not recording');
  }
  // Still active here, so a collector's closing sample lands in this recording.
  runCollectors('onStop', (collector) => collector.onStop?.());
  const duration = now() - session.startedAtMonotonic;
  const releasedAt = new Date().toISOString();
  session.releaseCutoff = duration;
  recordingSession = undefined;
  disableTraceTargets();
  session.draining = true;
  try {
    if (
      session.cpuObserver &&
      session.cpuSource &&
      session.cpuSource !== 'unavailable'
    ) {
      captureCpuEntries(
        session,
        session.cpuSource,
        session.cpuObserver.takeRecords(),
      );
      session.cpuObserver.disconnect();
    }
    session.browserStop?.();
  } finally {
    session.draining = false;
  }
  const recording: TraceRecording = {
    aggregates: [...session.aggregates.values()],
    browserCapabilities: session.browserCapabilities,
    browserSamples: session.browserSamples,
    cpuSamples: session.cpuSamples,
    cpuSource: session.cpuSource,
    droppedBrowserSamples: session.droppedBrowserSamples,
    droppedFunctionWindows: session.droppedFunctionWindows,
    duration,
    extensionSamples: session.extensionSamples,
    functionWindows: [...session.lightWindows]
      .sort(([left], [right]) => left - right)
      .map(([index, window]) => ({
        at: index * session.lightWindowMs,
        functions: [...window.functions.values()],
        otherCalls: window.otherCalls,
        otherDuration: window.otherDuration,
        span: session.lightWindowMs,
      })),
    mode: session.mode,
    releasedAt,
    schemaVersion: 1,
    sessionId: session.id,
    startedAt: session.startedAt,
    timelineOrigin: session.startedAtMonotonic,
    traces: [...session.heaps].map((heap) => ({
      events: synthesizeEvents(heap),
      metadata: heap.metadata,
      ray: heap.ray,
    })),
  };

  for (const heap of session.heaps) {
    releaseHeap(heap);
  }
  setGlobalState(getRecordingState());
  return decorateRecording(recording);
}

function decorateDescriptor(
  descriptor: PropertyDescriptor,
  name: string,
  namespace = DEFAULT_NAMESPACE,
  captureArguments?: boolean,
): PropertyDescriptor {
  if (isTraceIgnoredDescriptor(descriptor)) {
    return descriptor;
  }
  if (
    typeof descriptor.value === 'function' &&
    !decoratedFunctions.has(descriptor.value)
  ) {
    descriptor.value = trace(descriptor.value, name, {
      captureArguments:
        captureArguments ??
        !traceArgumentSnapshotDisabledFunctions.has(descriptor.value),
      namespace,
    });
  }
  if (
    typeof descriptor.get === 'function' &&
    !decoratedFunctions.has(descriptor.get)
  ) {
    descriptor.get = trace(descriptor.get, `${name}.get`, { namespace });
  }
  if (
    typeof descriptor.set === 'function' &&
    !decoratedFunctions.has(descriptor.set)
  ) {
    descriptor.set = trace(descriptor.set, `${name}.set`, { namespace });
  }
  return descriptor;
}

function registerTraceTarget(
  target: object,
  key: PropertyKey,
  name: string,
  namespace = DEFAULT_NAMESPACE,
  captureArguments?: boolean,
): void {
  const keys = traceTargetKeys.get(target) ?? new Set<PropertyKey>();
  if (keys.has(key)) {
    return;
  }
  keys.add(key);
  traceTargetKeys.set(target, keys);
  const registration = { captureArguments, key, name, namespace, target };
  traceTargets.add(registration);
  if (recordingSession) {
    enableTraceTarget(registration);
  }
}

function enableTraceTargets(): void {
  for (const registration of traceTargets) {
    enableTraceTarget(registration);
  }
}

function enableTraceTarget(registration: TraceTarget): void {
  const { key, target } = registration;
  const original = Object.getOwnPropertyDescriptor(target, key);
  const descriptor = original ?? findTraceDescriptor(target, key);
  if (!descriptor || (original && !original.configurable)) {
    return;
  }
  const traced = decorateDescriptor(
    { ...descriptor },
    registration.name,
    registration.namespace,
    registration.captureArguments,
  );
  if (
    traced.value === descriptor.value &&
    traced.get === descriptor.get &&
    traced.set === descriptor.set
  ) {
    return;
  }
  Object.defineProperty(target, key, traced);
  activeTraceTargets.push({ installed: traced, key, original, target });
}

function findTraceDescriptor(
  target: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  let owner = Object.getPrototypeOf(target);
  while (owner && owner !== Object.prototype && owner !== Function.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) {
      return descriptor;
    }
    owner = Object.getPrototypeOf(owner);
  }
  return undefined;
}

function disableTraceTargets(): void {
  for (const {
    installed,
    key,
    original,
    target,
  } of activeTraceTargets.reverse()) {
    const current = Object.getOwnPropertyDescriptor(target, key);
    if (
      current?.value !== installed.value ||
      current?.get !== installed.get ||
      current?.set !== installed.set
    ) {
      continue;
    }
    if (original) {
      Object.defineProperty(target, key, original);
    } else {
      Reflect.deleteProperty(target, key);
    }
  }
  activeTraceTargets.length = 0;
}

/**
 * `@TraceIgnore` and `@TraceWithoutArguments` record their targets in module
 * private WeakSets. Wrappers installed outside this package -- the dependency
 * injection container is one -- cannot read those, so the decorators also
 * stamp a well-known symbol on the function. Anything that wraps a method must
 * honour both markers or the opt-outs are silently lost.
 */
export const TRACE_IGNORED = Symbol.for('editor-platform.trace.ignored');
export const TRACE_NO_ARGUMENTS = Symbol.for(
  'editor-platform.trace.no-arguments',
);

function markTraceOptOut(fn: AnyFunction, marker: symbol): void {
  Object.defineProperty(fn, marker, {
    configurable: true,
    enumerable: false,
    value: true,
  });
}

/**
 * Keeps a method in recordings while avoiding snapshots of large or sensitive
 * arguments. Apply before the containing class is decorated with `@Trace`.
 */
export function TraceWithoutArguments(
  _target: object,
  _propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  if (typeof descriptor.value === 'function') {
    traceArgumentSnapshotDisabledFunctions.add(descriptor.value);
    markTraceOptOut(descriptor.value, TRACE_NO_ARGUMENTS);
  }
  return descriptor;
}

/**
 * Excludes internal implementation plumbing from recordings while allowing
 * public methods that call it to remain fully traced.
 */
export function TraceIgnore(
  _target: object,
  _propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  for (const candidate of [descriptor.value, descriptor.get, descriptor.set]) {
    if (typeof candidate === 'function') {
      traceIgnoredFunctions.add(candidate);
      markTraceOptOut(candidate, TRACE_IGNORED);
    }
  }
  return descriptor;
}

function decoratePrototypeMethods(
  Class: AnyConstructor,
  className: string,
): void {
  const decoratedNames = new Set<string>();
  let prototype = Class.prototype;

  while (prototype && prototype !== Object.prototype) {
    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor' || decoratedNames.has(propertyName)) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        prototype,
        propertyName,
      );
      if (descriptor) {
        Object.defineProperty(
          Class.prototype,
          propertyName,
          decorateDescriptor({ ...descriptor }, `${className}.${propertyName}`),
        );
        decoratedNames.add(propertyName);
      }
    }
    prototype = Object.getPrototypeOf(prototype);
  }
}

function decorateStaticMethods(Class: AnyConstructor, className: string): void {
  const decoratedStaticNames = new Set([
    'arguments',
    'caller',
    'length',
    'name',
    'prototype',
  ]);
  let constructor = Class;

  while (constructor && constructor !== Function.prototype) {
    for (const propertyName of Object.getOwnPropertyNames(constructor)) {
      if (decoratedStaticNames.has(propertyName)) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(
        constructor,
        propertyName,
      );
      if (descriptor) {
        Object.defineProperty(
          Class,
          propertyName,
          decorateDescriptor({ ...descriptor }, `${className}.${propertyName}`),
        );
        decoratedStaticNames.add(propertyName);
      }
    }
    constructor = Object.getPrototypeOf(constructor);
  }
}

function decorateClass<T extends AnyConstructor>(Class: T): T {
  if (!isTracingRequested()) {
    return Class;
  }
  const namespace = (Class as AnyConstructor & { namespace?: unknown })
    .namespace;
  const className =
    typeof namespace === 'string' && namespace
      ? namespace
      : Class.name || 'anonymous';
  decoratePrototypeMethods(Class, className);
  decorateStaticMethods(Class, className);
  return Class;
}

export function Trace<T extends AnyConstructor>(target: T): T;
export function Trace(
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
): PropertyDescriptor;
export function Trace(
  target: unknown,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
): unknown {
  if (propertyKey === undefined && descriptor === undefined) {
    return decorateClass(target as AnyConstructor);
  }
  return descriptor && propertyKey !== undefined
    ? decorateDescriptor(descriptor, String(propertyKey))
    : descriptor;
}

export interface GlobalTracingApi {
  getRecordingState: () => TraceRecordingState;
  isRecordingActive?: typeof isRecordingActive;
  /** Whether this page asked for tracing; see isTracingRequested. */
  isTracingRequested?: () => boolean;
  marker?: typeof marker;
  record: (options?: TraceRecordingOptions) => TraceRecordingState;
  recordSession?: (
    title: string,
    options: TraceRecordingOptions & { serverUrl: string },
  ) => Promise<TraceRecordingState>;
  registerCollector: (collector: TraceCollector) => () => void;
  release: () => TraceRecording;
  releaseSession?: () => Promise<TraceRecording>;
  run: (
    namespace: string,
    name: string,
    fn: AnyFunction,
    thisArg: unknown,
    args: unknown[],
    captureArguments?: boolean,
  ) => unknown;
  wrapService: <T extends object>(
    service: T,
    name: string,
    namespace: string,
  ) => T;
}

export function wrapTraceService<T extends object>(
  service: T,
  name: string,
  namespace = DEFAULT_NAMESPACE,
): T {
  if (!isTracingRequested()) {
    return service;
  }
  for (const propertyName of Object.getOwnPropertyNames(service)) {
    const descriptor = Object.getOwnPropertyDescriptor(service, propertyName);
    if (
      !descriptor ||
      typeof descriptor.value !== 'function' ||
      isDecoratedPrototypeMethod(service, propertyName) ||
      isIgnoredPrototypeMethod(service, propertyName)
    ) {
      continue;
    }
    registerTraceTarget(
      service,
      propertyName,
      `${name}.${propertyName}`,
      namespace,
      isArgumentSnapshotDisabledOnPrototype(service, propertyName)
        ? false
        : undefined,
    );
  }
  return service;
}

function isIgnoredPrototypeMethod(
  service: object,
  propertyName: string,
): boolean {
  let prototype = Object.getPrototypeOf(service);
  while (prototype && prototype !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
    if (descriptor && isTraceIgnoredDescriptor(descriptor)) {
      return true;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function isArgumentSnapshotDisabledOnPrototype(
  service: object,
  propertyName: string,
): boolean {
  let prototype = Object.getPrototypeOf(service);
  while (prototype && prototype !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
    if (descriptor && typeof descriptor.value === 'function') {
      return traceArgumentSnapshotDisabledFunctions.has(descriptor.value);
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function isTraceIgnoredDescriptor(descriptor: PropertyDescriptor): boolean {
  return [descriptor.value, descriptor.get, descriptor.set].some(
    (candidate) =>
      typeof candidate === 'function' && traceIgnoredFunctions.has(candidate),
  );
}

function isDecoratedPrototypeMethod(
  service: object,
  propertyName: string,
): boolean {
  let prototype = Object.getPrototypeOf(service);
  while (prototype && prototype !== Object.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
    if (typeof descriptor?.value === 'function') {
      return decoratedFunctions.has(descriptor.value);
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

const GLOBAL_API_VERSION_KEY = Symbol.for(
  '@sx/tracing/global-api/v2',
);

export function getGlobalTracing(): GlobalTracingApi {
  const existing = globalThis.__EDITOR_TRACING__;
  if (existing && Reflect.get(existing, GLOBAL_API_VERSION_KEY) === true) {
    return existing;
  }
  if (existing?.getRecordingState().isRecording) {
    throw new Error('Release the existing trace before loading browser mode');
  }
  const api: GlobalTracingApi = existing ?? ({} as GlobalTracingApi);
  Object.assign(api, {
    getRecordingState,
    isRecordingActive,
    isTracingRequested,
    marker,
    record: startRecording,
    registerCollector: registerTraceCollector,
    release: releaseRecording,
    run: (namespace, name, fn, thisArg, args, captureArguments) =>
      runTracedFunction(namespace, name, fn, thisArg, args, captureArguments),
    wrapService: wrapTraceService,
  } satisfies GlobalTracingApi);
  Object.defineProperty(api, GLOBAL_API_VERSION_KEY, {
    value: true,
  });
  if (!existing) {
    Object.defineProperty(globalThis, '__EDITOR_TRACING__', {
      configurable: true,
      enumerable: false,
      value: api,
      writable: false,
    });
  }
  return api;
}

getGlobalTracing();

/**
 * Installs the session layer on the global API. Only this package calls it:
 * `session.ts` sits above this module, so it cannot be imported from here
 * without a cycle. Assignment matches how `getGlobalTracing` installs the rest
 * of the API, so a fresh load replaces the methods of a stale global left by an
 * earlier version. Layers outside this package take part through
 * `registerTraceCollector` instead of assigning onto the global object.
 */
export function setGlobalSessionApi(api: {
  recordSession: NonNullable<GlobalTracingApi['recordSession']>;
  releaseSession: NonNullable<GlobalTracingApi['releaseSession']>;
}): void {
  const global = getGlobalTracing();
  global.recordSession = api.recordSession;
  global.releaseSession = api.releaseSession;
}

declare global {
  // Debugging hook exposed intentionally for runtime inspection in DevTools.
  // Do not assign onto it: extend a recording with registerTraceCollector.

  var __EDITOR_PLATFORM_TRACING__: TraceRecordingState | undefined;
  var __EDITOR_TRACING__: GlobalTracingApi | undefined;
}
