# One tracing layer across frontend subsystems

[Documentation index](./README.md) · [Ray metadata](./examples/ray-metadata.md) · [Consumer extensions](../packages/tracing/EXTENDING.md)

A frontend shell, independently built microfrontends, shared libraries, and service
adapters can contribute to **one recording** when they execute in the same browser
JavaScript realm and use compatible copies of this tracing runtime. Each subsystem
keeps its own namespace and custom data, while capture state and transport are shared.

This is particularly useful for frontend “microservices”: several separately
owned modules cooperating within one page. It is not automatic distributed tracing
between independent servers or isolated browser contexts.

## What is shared, and where?

```text
One page / one JavaScript realm

  shell ───────── trace(namespace: shell) ───────┐
  catalog remote ─ trace(namespace: catalog) ────┤
  cart remote ──── trace(namespace: cart) ───────┼─ shared runtime on globalThis
  cache adapter ── collector + custom samples ──┤       │
  legacy plugin ── global API run(...) ─────────┘       │
                                               one active recording
                                                      │
                                               shared transport
                                                      │
                                               dashboard session
```

| Boundary | Automatically shared? | Meaning |
| --- | --- | --- |
| Modules and separately bundled microfrontends running in the same window | Yes, with compatible runtime owners | Common capture state, collectors, recording updates and transport |
| Duplicate ESM/CJS or bundled copies in that realm | Compatible copies converge on registered owners | Module deduplication is useful but not the only sharing mechanism |
| Different namespaces within one recording | Same recording, distinct event namespaces | Preserve subsystem identity and avoid function-name collisions |
| Independent top-level operations | Same recording, usually different rays | A shared recording does not force every operation into one call tree |
| iframe, including same-origin iframe with its own runtime | No | Separate global object and recording state |
| Worker, service worker, another tab/window | No | Requires explicit coordination/correlation |
| Backend microservices or another process | No | No automatic network context propagation or merged distributed trace |

An iframe runs in a separate realm even when it can communicate with its parent.
The fact that symbol identities can be shared does not make properties stored on
separate global objects the same state. [JavaScript execution model](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model).

## How the implementation joins compatible copies

The package uses two mechanisms with different jobs:

| Mechanism | Job |
| --- | --- |
| `globalThis[Symbol.for('@sx/tracing/runtime/v2')]` | Shared capture implementation used by tracing exports |
| `globalThis[Symbol.for('@sx/tracing/transport/v2')]` | Shared upload implementation used by recordings exports |
| `globalThis.__EDITOR_TRACING__` | Public debugging/integration facade: record, release, run, collector registration, and optional session methods |
| `globalThis.__EDITOR_PLATFORM_TRACING__` | Published recording-state snapshot for inspection, not a separate controller |

The first implementation registered under the runtime key becomes the owner.
Later compatible copies resolve exported functions through that owner rather than
creating independent capture sessions. The transport follows the same ownership
pattern. Named keys and the console-global names are retained compatibility
identifiers; consumers should use normal imports rather than manipulating symbols.

The recording schema is version 1. The owner keys contain `v2`. These are separate
version concepts; neither one is proof that arbitrary npm versions interoperate.

Source references:

- [Runtime export ownership](../packages/tracing/src/tracing.ts).
- [Transport ownership](../packages/recordings/src/recordingTransport.ts).
- [Global facade and capture implementation](../packages/tracing/src/runtime.ts).
- [Session integration](../packages/recordings/src/session.ts).

## Host owns the recording; subsystems contribute

1. Load the page with `?install-tracing` before instrumentation is defined.
2. Bootstrap the intended shared package version in the shell before loading remotes.
3. Subsystems instrument functions and register their own collectors.
4. The shell starts one recording/session around a user scenario.
5. The shell awaits measured work, then releases the recording/session once.
6. Subsystems unregister collectors and remove their own listeners when disposed.

Do not let each remote call `recordSession` independently: there is one active
recording per realm, and a second session start rejects. A subsystem calling
`releaseRecording` can stop the shell's capture for everyone. Treat start/stop
ownership as an application contract, not a permission enforced by the library.

### Bootstrap order

Application wiring fragment, with remote modules owned by your application:

```ts
// The URL already contains install-tracing before this module evaluates.
const recordings = await import('@sx/recordings');
// Now load the application's remote bundles and their instrumentation.
// await loadCatalogRemote();
// await loadCartRemote();

console.log(recordings.getRecordingState().isRecording); // false before capture
```

Using a dynamic bootstrap boundary makes the intended ordering explicit. A
compatible dependency singleton in your bundler can also reduce duplication;
the library does not configure Module Federation or your import map for you.

The installation decision is cached. Adding the URL flag after modules have
already evaluated does not retrofit instrumentation. Configure the URL first and
reload. Importing `@sx/tracing` installs core capture; importing `@sx/recordings`
adds session methods and transport.

## Complete example: three subsystems, one ray, one recording

This single-file demonstration represents functions that can live in independently
built modules in the same page. In real subsystems, each module imports the public
package API; it does not need a reference to another module's private recorder.
Load with the installation flag before evaluating it.

```ts
import {
  addTraceExtensionSample, getGlobalTracing, marker, registerTraceCollector,
  releaseRecording, setTraceRayMetadata, startRecording, trace,
} from '@sx/tracing';

// Catalog subsystem.
const loadProduct = trace(() => {
  setTraceRayMetadata('catalog.result', { version: 1, source: 'cache' });
  marker('cache-hit', { version: 1, cache: 'products' });
  return { id: 'product-1', price: 12 };
}, 'loadProduct', { namespace: 'catalog' });

// Cart subsystem.
const addToCart = trace((product: { id: string; price: number }) => {
  setTraceRayMetadata('cart.result', { version: 1, items: 1 });
  return product.price;
}, 'addToCart', { namespace: 'cart' });

// Independent consumer data, collected for the same recording.
const unregister = registerTraceCollector({
  name: 'cart.metrics',
  onStop: () => addTraceExtensionSample('cart.metrics', { version: 1, updates: 1 }),
});

// Shell operation calls both subsystems synchronously under one root.
const checkout = trace(() => {
  setTraceRayMetadata('shell.operation', { version: 1, action: 'checkout' });
  return addToCart(loadProduct());
}, 'checkout', { namespace: 'shell' });

try {
  startRecording({ mode: 'full', cpu: false });
  console.assert(getGlobalTracing().getRecordingState().isRecording);
  try {
    console.assert(checkout() === 12);
  } finally {
    const recording = releaseRecording();
    console.log(recording.traces.length); // 1 root ray for this synchronous example
    console.log([...new Set(recording.traces[0].events.map(event => event.namespace))]);
    // ['shell', 'catalog', 'cart']
    console.log(Object.keys(recording.traces[0].metadata ?? {}));
    // ['shell.operation', 'catalog.result', 'cart.result']
    console.log(recording.extensionSamples?.some(sample => sample.channel === 'cart.metrics'));
    // true
  }
} finally {
  unregister();
}
```

For delivery to the dashboard, the shell uses `recordSession` / `releaseSession`
from `@sx/recordings` instead of the in-memory pair. Other subsystems keep their
instrumentation and collector code unchanged. One transport batches the combined
updates to one saved session.

Synchronous nesting in this example preserves one ray. Async nesting additionally
depends on supported await chains and stack recovery. A shared global does not
repair a broken callback chain or prove that unrelated events belong to the same
operation. Use explicit handles for [metadata after awaits](./examples/ray-metadata.md).

## Integrate code that cannot import the package

A legacy plugin can use the facade after the host has installed it. This JavaScript
adapter retains ordinary behavior when tracing is absent:

```js
function runPluginWork(value) {
  const work = input => input * 2;
  const api = globalThis.__EDITOR_TRACING__;
  return api ? api.run('plugin.analytics', 'compute', work, undefined, [value]) : work(value);
}
```

`run(namespace, name, fn, thisArg, args)` preserves the function result and provides
a namespace for its events. For a method that uses `this`, pass the actual receiver.
The host still starts and stops capture. The plugin should look up the facade at
invocation time if it may load before the host initializes tracing.

| Imported API | Global facade equivalent |
| --- | --- |
| `getRecordingState()` | `getRecordingState()` |
| `startRecording(options)` | `record(options)` |
| `releaseRecording()` | `release()` |
| `registerTraceCollector(collector)` | `registerCollector(collector)` |
| `runTracedFunction(...)` | `run(...)` |
| `wrapTraceService(service, name, namespace)` | `wrapService(service, name, namespace)` |
| `recordSession(...)` / `releaseSession()` | Optional methods installed by recordings |

The facade is intentionally not a mirror of every imported API. Ray metadata and
extension-sample writers are accessed through imports or an explicit consumer-owned
adapter. Do not invent `__EDITOR_TRACING__.setTraceRayMetadata`, and do not assign
new recording methods onto the shared object to extend it. Use collectors and the
public imports. `setGlobalSessionApi` is package plumbing, not a subsystem extension hook.

## Coordinate names, versions and lifecycle

- **Namespace each subsystem.** `catalog.load` and `cart.load` must remain distinct
  even when both functions are named `load`. The dashboard's identity helpers use
  namespace plus name; names alone are not a unique cross-subsystem key.
- **Namespace collector names and data owners.** Two collectors with the same name
  replace each other. Give independent features distinct registrations; dispose
  the old registration when a feature unloads.
- **Align deployed versions.** The runtime resolver falls back to a copy's local
  implementation if the first owner lacks an exported API. That keeps a function
  available but may split state: a collector registered in the fallback copy can
  miss a recording owned by the older runtime. Shared key names alone do not
  guarantee mixed-version compatibility. The transport has no equivalent per-method
  compatibility negotiation.
- **Load the intended owner first.** Test the actual remote-load order and package
  versions shipped by the shell and every microfrontend. Prefer one coordinated
  version and bundler sharing policy.
- **Reload after runtime upgrades.** Global owners can survive module reload/HMR.
  Do not clear symbol slots or overwrite the global facade during capture. Test
  fresh page loads; importing newer code is not a guaranteed owner upgrade.
- **Wait for participant readiness.** Install collectors before capture begins.
  Late-mounted subsystems were not present for earlier events and cannot recover
  them. Their initialization should be part of the scenario if that is what you
  need to measure.
- **Bound resources.** Cancel consumer timers/listeners and pending work before
  disposal. Hooks are synchronous; recording release does not await arbitrary
  async cleanup or give every microfrontend an independent recording lifetime.

## Iframes, workers and backend services

Each isolated participant needs its own capture lifecycle. Posting a ray handle
or using the same symbol string does not attach the recipient to the sender's
heap. HTTP requests do not carry recording context automatically.

If you need cross-boundary correlation, design it explicitly:

1. Create an application correlation ID and pass it in the application's message
   or request protocol, subject to the application's trust and privacy rules.
2. Record that ID as consumer metadata on each relevant operation.
3. Keep the originating realm/service, source build, session ID and ray ID with
   each observation. Native recording IDs are not a globally coordinated namespace.
4. Retain separate recordings, or implement and validate a consumer-owned bridge
   or projection. Clocks, message ordering, deduplication and ownership need explicit
   handling; do not concatenate relative timestamps as if they share one timeline.

There is no built-in cross-realm aggregator, HTTP propagation, or W3C trace-context
integration in this package. Use an appropriate distributed tracing integration
for backend services. Correlation IDs help connect evidence; they do not prove
causality, authorize access, or merge traces in the default dashboard automatically.

## Verification for a multi-subsystem application

Before depending on a deployment, check that:

- Starting from the shell is visible to each subsystem's `getRecordingState()`.
- One scenario includes calls from every expected namespace and collector channel.
- Nested calls share the expected ray; independent roots remain distinct.
- Concurrent operations keep their metadata isolated and stale handles fail.
- Duplicate package imports, the real load order, and any HMR behavior are tested.
- Release flushes the combined data and all participants return to inactive state.

The repository's [metadata tests](../packages/tracing/tests/metadata.spec.ts),
[collector tests](../packages/tracing/tests/collectors.spec.ts), and
[installed-package consumer check](../scripts/fixtures/package-consumer.mjs) cover
shared-owner behavior, including compatible imports. They do not replace a test
of your particular bundler topology or establish arbitrary-version compatibility.
