# Choosing where extra tracing data belongs

[Examples](./README.md) · [Collector lifecycle](../../packages/tracing/EXTENDING.md#take-part-in-every-recording)

| Data | API | Scope | Modes |
| --- | --- | --- | --- |
| Request/component identity, final operation outcome | `setTraceRayMetadata` | One ray, one value per owner | Full |
| A cache hit or validation event at a particular point | `marker` | Current call's timed child event | Full |
| Queue depth, resource samples, recording-wide statistics | `addTraceExtensionSample` | Recording, named channel | Full/light |
| Start/stop sampling whenever any recording starts | `registerTraceCollector` | Consumer lifecycle hooks | Hooks run for recordings; samples still follow mode rules |

Metadata snapshots values; markers and ordinary extension samples do not snapshot
payloads automatically. Emit new small JSON-safe objects rather than mutating an
object after sending it. Never manufacture reserved `tracing.*` messages.

## 1. Timed markers plus a final ray summary

This complete in-memory example requires the installation URL flag before import.
The marker identifies *when* a cache hit happened; metadata describes the operation.

```ts
import {
  marker, releaseRecording, setTraceRayMetadata, startRecording, trace,
} from '@sx/tracing';

const load = trace((productId: string) => {
  setTraceRayMetadata('catalog.operation', { version: 1, productId });
  marker('cache-hit', { version: 1, cache: 'products' });
  setTraceRayMetadata('catalog.outcome', { version: 1, source: 'cache' });
  return { id: productId };
}, 'load', { namespace: 'catalog' });

startRecording({ mode: 'full', cpu: false });
try { load('product-1'); }
finally {
  const recording = releaseRecording();
  const ray = recording.traces[0];
  console.log(ray.metadata?.['catalog.outcome']);
  console.log(ray.events.filter(event => event.kind === 'marker'));
}
```

The marker name is `load.cache-hit`; its `parent` refers to the call event within
that ray. Join using ray ID plus event ID. A function name alone does not identify
a unique call, and equal function names in different namespaces are not one function.

## 2. An independent sample with an explicit ray correlation

Use this pattern when a consumer's analytics use a shared channel but also need
to identify the operation that produced each observation:

```ts
import {
  addTraceExtensionSample, getActiveTraceRay, releaseRecording,
  startRecording, trace,
} from '@sx/tracing';

const measure = trace(async () => {
  const ray = getActiveTraceRay();
  await Promise.resolve();
  if (ray) addTraceExtensionSample('search.result-count', {
    version: 1, ray: ray.ray, count: 12,
  });
}, 'measure', { namespace: 'search' });

startRecording({ mode: 'full', cpu: false });
try { await measure(); }
finally { console.log(releaseRecording().extensionSamples); }
```

The `ray` field is consumer-defined data, not an implicit core join. The shared
clock supplies the sample's `at`. Await the work before release: extension samples
attach to the currently active recording, whereas `setTraceRayMetadata` checks a
handle's session identity. Do not let a late callback accidentally emit into the
next recording. Cancel pending work or check the active session before emitting.

## 3. Reusable collector configured by its consumer

Pass consumer settings through the collector factory's closure instead of inventing
unsupported fields on `TraceRecordingOptions`. This collector emits an opening and
closing queue depth, with no timer or unbounded per-event buffer:

```ts
import {
  addTraceExtensionSample, registerTraceCollector, releaseRecording,
  startRecording,
} from '@sx/tracing';

function installQueueCollector(channel: string, readDepth: () => number) {
  let enabled = false;
  const emit = (phase: 'start' | 'stop') => {
    if (enabled) addTraceExtensionSample(channel, {
      version: 1, phase, depth: readDepth(),
    });
  };
  return registerTraceCollector({
    name: channel,
    onStart: (_state, options) => {
      enabled = options.mode !== 'browser';
      emit('start');
    },
    onStop: () => { emit('stop'); enabled = false; },
  });
}

let pending = 4;
const uninstall = installQueueCollector('worker.queue', () => pending);
try {
  startRecording({ mode: 'light', cpu: false });
  try { pending = 1; }
  finally { console.log(releaseRecording().extensionSamples); }
} finally {
  uninstall();
}
```

Install collectors once per consumer lifetime. Names identify registrations;
registering the same name replaces the earlier registration. Register and unregister
between recordings when practical. Hooks are synchronous contracts; an async hook
is not awaited. `onStop` runs while capture is active, so closing samples are kept.
A thrown hook is reported through the collector-error channel; still ensure your
own timers/listeners are cleaned up if your hook fails halfway through.

## 4. Add a derived value at release

This is a registration fragment to use before starting a full/light recording:

```ts
import { registerTraceCollector } from '@sx/recordings';

const uninstall = registerTraceCollector({
  name: 'application.summary',
  decorate: recording => ({
    ...recording,
    extensionSamples: [
      ...(recording.extensionSamples ?? []),
      {
        at: recording.duration,
        channel: 'application.summary',
        data: { version: 1, durationMs: recording.duration },
      },
    ],
  }),
});
// Keep installed for the recording lifetime; call uninstall() on disposal.
```

Keep existing samples and their object identities so transport deduplication can
recognize already-streamed samples. Appending a namespaced sample persists it in
the final upload. Adding an arbitrary top-level property instead only creates a
local projection. Consumer-specific schema validation, versioning, bounds and
aggregation remain the consumer's responsibility.
