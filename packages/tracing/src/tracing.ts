import * as implementation from './runtime';

export type * from './runtime';

const key = Symbol.for('@sx/tracing/runtime/v2');
const registry = globalThis as typeof globalThis & {
  [key]?: Partial<typeof implementation>;
};
const runtime = (registry[key] ??= implementation);

/**
 * Resolve an export from whichever copy of the package claimed the shared
 * owner first, so every copy drives the same recording state.
 *
 * Falls back to this copy when the owner does not provide the name. An owner
 * installed by an older version predates any API added since, and a module
 * namespace object cannot be extended, so the alternative would be exporting
 * `undefined` and throwing on first use. The fallback keeps the package usable;
 * the caveat is that an API backed by this copy reads this copy's module state,
 * so a collector registered here does not take part in a recording the older
 * owner started.
 */
function shared<TName extends keyof typeof implementation>(
  name: TName,
): (typeof implementation)[TName] {
  return (runtime[name] ??
    implementation[name]) as (typeof implementation)[TName];
}

export const getRecordingState = shared('getRecordingState');
export const isRecordingActive = shared('isRecordingActive');
export const startRecording = shared('startRecording');
export const addTraceExtensionSample = shared('addTraceExtensionSample');
export const getActiveTraceRay = shared('getActiveTraceRay');
export const setTraceRayMetadata = shared('setTraceRayMetadata');
export const withTracingSuspended = shared('withTracingSuspended');
export const subscribeRecordingUpdates = shared('subscribeRecordingUpdates');
export const getCompletedRecordingUpdates = shared(
  'getCompletedRecordingUpdates',
);
export const trace = shared('trace');
export const runTracedFunction = shared('runTracedFunction');
export const withTrace = shared('withTrace');
export const marker = shared('marker');
export const traceStep = shared('traceStep');
export const releaseRecording = shared('releaseRecording');
export const TraceWithoutArguments = shared('TraceWithoutArguments');
export const TraceIgnore = shared('TraceIgnore');
export const Trace = shared('Trace');
export const wrapTraceService = shared('wrapTraceService');
export const getGlobalTracing = shared('getGlobalTracing');
export const isTracingRequested = shared('isTracingRequested');
export const registerTraceCollector = shared('registerTraceCollector');
export const setGlobalSessionApi = shared('setGlobalSessionApi');
