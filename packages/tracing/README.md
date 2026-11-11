# @sx/tracing — capture and instrumentation

Opt-in browser tracing. `@sx/tracing` owns instrumentation and in-memory capture;
`@sx/recordings` adds sessions and streaming transport and re-exports the tracing API. The package is the recorder only: no React UI,
no Node server, no Platform cache model, and no dependency-injection services.

Documentation for the recorder **and** the dashboard lives here:

| Document                                               | Contents                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| This file                                              | Install, record, and the instrumentation API                     |
| [Dashboard and server](./DASHBOARD.md)                 | Running the UI and server, entry points, embedding, reading data |
| [Extending](./EXTENDING.md)                            | Emitting custom data, then rendering it as custom UI             |
| [Performance reports](./PERFORMANCE_REPORTS.md)        | Generated comparison reports, configuration, and formulas        |
| [Guidelines](./GUIDELINES.md)                          | Ownership, compatibility, and release rules                      |
| [Offline analytics](./tools/recording-query/README.md) | Querying large recordings from the command line                  |

## Package boundaries

Import `@sx/tracing` for in-memory capture. Use [`@sx/recordings`](../recordings/README.md) for the session and upload APIs shown in this guide; it re-exports tracing. [`@sx/dashboard`](../dashboard/README.md) supplies the UI and server. The original `@sx/tracer` is a separate API.

Read [how Error().stack recovery works](../../docs/how-tracing-works.md) for the core mechanism, [the walkthrough](../../docs/getting-started.md) for setup, and [troubleshooting](../../docs/troubleshooting.md) for activation and async limitations. Package publication is not implied; [local archives](../../docs/development.md#local-package-archives) work before release.

## Install

Install the packages from npm:

```sh
yarn add @sx/recordings
yarn add --dev @sx/dashboard
```

The recorder runs in the browser. The dashboard is a development dependency: it
provides the local server that receives recordings and the UI that reads them.
Node 22.14 or newer is required for the server.

## Start the dashboard

The dashboard ships a launcher. Run it from the directory where you want
recordings stored:

```sh
yarn trace-dashboard --port 4178
```

Open `http://127.0.0.1:4178`. Recordings are written to `.recordings` in the
launching directory, and the server binds to loopback. To choose the directory:

```sh
yarn trace-dashboard --recordings ./local-traces --port 4178
```

Point `recordSession` at that URL and the session appears in the list when you
release it. See [Dashboard and server](./DASHBOARD.md) for embedding the UI,
running the server programmatically, and the Vite adapter.

## Turn tracing on

Tracing is opt-in per page. Nothing is instrumented until the URL carries the
`install-tracing` query parameter:

```
https://app.example.com/?install-tracing
```

Without it `trace`, `@Trace` and `wrapTraceService` hand back the original
function, class or service, and `run` passes straight through. Consumer adapters
should honor the same installation gate. These calls avoid tracing wrapper
indirection when the flag is absent.

`startRecording` and `recordSession` throw in that state rather than returning
an empty recording, because a capture with no calls in it reads as "the code
ran nothing" instead of "tracing was not installed". Browser-signal captures
are the exception and work either way, since they never install wrappers:

```ts
await recordSession('Mouse movement', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'browser',
});
```

The decision is read once from `location` and cached, because classes are
decorated while modules evaluate. On the server and in workers there is no
`location`, which reads as "not installed" rather than failing. Other layers
read the same answer through `isTracingRequested()`, exported here and exposed
on `globalThis.__EDITOR_TRACING__`, instead of parsing the URL themselves.

## Record

Instrument the code, start a session, perform the interaction, release it.

```ts
import {
  recordSession,
  releaseSession,
  trace,
} from '@sx/recordings';

export const resize = trace(
  (componentId: string, width: number) => {
    // Perform the application's resize operation here.
    return { componentId, width };
  },
  'Component.resize',
  { namespace: 'editor-platform' },
);

await recordSession('Resize a component', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'full',
});
resize('comp-1', 320);
const recording = await releaseSession();
```

### Starting and stopping

There are two pairs. Use the session pair to stream to the dashboard; use the
recording pair to capture in memory with no server.

| Call                                              | Effect                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `recordSession(title, { serverUrl, ...options })` | Starts capture and checks the server before resolving. If the check fails it stops the recording it started. |
| `releaseSession()`                                | Stops capture, flushes uploaded data, and finalizes server-side storage.                                     |
| `startRecording(options)`                         | Starts capture in memory. No server involved.                                                                |
| `releaseRecording()`                              | Stops capture and returns the serializable recording data.                                                   |
| `getRecordingState()`                             | Reads status without stopping capture.                                                                       |

Importing tracing installs the core `globalThis.__EDITOR_TRACING__` API; importing
recordings adds session methods, so the same
methods are reachable from the browser console without wiring a UI:

```js
await __EDITOR_TRACING__.recordSession('Mouse move', {
  serverUrl: 'http://127.0.0.1:4178',
});
// interact with the app
await __EDITOR_TRACING__.releaseSession();
```

Only one recording can be active per JavaScript realm. Independent imports share
the same version-2 runtime and transport owner through global symbols, so
decorators, markers, metadata, and custom samples all reach the same session.
Separate workers and iframes have separate globals. Status reads use an
incremental event count, so polling does not scan retained trace trees.

## Instrument code

`trace(fn, name?, options?)` returns an instrumented function — call the
returned reference, not the original.

```ts
const resize = trace(fn, 'Component.resize', {
  namespace: 'editor-platform',
  captureArguments: true,
});
```

| Option             | Default                     | Effect                                                        |
| ------------------ | --------------------------- | ------------------------------------------------------------- |
| `name`             | `fn.name`, else `anonymous` | The function name recorded and shown in the dashboard.        |
| `namespace`        | `editor-platform`           | Groups functions and disambiguates equal names across layers. |
| `captureArguments` | off                         | Bounded argument snapshots for this function.                 |

Other entry points:

- `withTrace(name, callback)` records a logical operation in the default
  namespace without wrapping a reusable function.
- `traceStep(name, callback)` records a step inside an active trace.
- `@Trace` installs a stable wrapper when the class or method is **defined**, so
  references bound before recording stay traceable. `@TraceIgnore` excludes a
  method; `@TraceWithoutArguments` disables argument snapshots for one method.
  Decorators need the repository's legacy TypeScript decorator configuration.
- `getGlobalTracing().run(namespace, name, fn, thisArg, args)` traces with an
  explicit layer namespace.

`@Trace` covers directly constructed classes. Consumers using dependency injection
can integrate `wrapTraceService` in their own adapter; this library does not
install a DI container. Methods are recorded as `ClassName.method`, or
`namespace.method` when the class has a `static namespace`. Methods inherited
from a decorated base retain their declaring class's name.

Enable legacy decorators in the consumer TypeScript configuration:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

Nested calls in full mode join the same ray and keep parent links. Returned
promises are timed through settlement; failures are recorded and rethrown.
Capture is opt-in: wrappers stay in place outside a recording and pass calls
straight through to the original function.

## Focus a recording

Recording everything is rarely what you want. Two mechanisms narrow it.

**By namespace** — set `namespace` when instrumenting so a layer's functions
group together, then filter by namespace in the dashboard's Functions and Trace
frames pages. Namespaces are a reporting dimension, not a capture filter.

**By method** — `methods` restricts what is actually captured:

```ts
await recordSession('Only resize and style', {
  serverUrl: 'http://127.0.0.1:4178',
  methods: ['Component.resize', 'odeditor.Style.setStyle'],
});
```

Entries come in two kinds, told apart by whether the entry contains a dot.

A **dotted entry is a path** and must match exactly, against either the
recorded `name` or the full `namespace.name`:

| Entry                                            | `SDK.builderComponent.setStyles` |
| ------------------------------------------------ | -------------------------------- |
| `editor-platform.SDK.builderComponent.setStyles` | matches                          |
| `SDK.builderComponent.setStyles`                 | matches                          |
| `builderComponent.setStyles`                     | does not match                   |

Partial paths do not match. `name` carries however many segments its
instrumentation chose -- two for a decorated class such as
`ManifestQuery.setStyles`, three for the composed SDK -- so accepting partial
paths would make a filter's meaning depend on naming that can change upstream.

A **bare entry is a search term**, matched anywhere in `name`:

```ts
methods: ['setStyles'];
```

This is a plain substring search, meant for exploring. It reaches more than the
exact method -- `setStylesInternal` extends it and `unsetStyles` contains it --
so spell the path out once you know what you are after.

The filter applies to **roots**. In full mode a matching root pulls in its whole
descendant tree, which is usually what you want for one interaction. In light
mode there is no call tree, so the filter matches individual functions.

To measure an interaction's cost without any method tracing at all, use
`mode: 'browser'`.

## Recording options

All options are accepted by `startRecording` and `recordSession`.

| Option                  | Default  | Effect                                                                 |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| `mode`                  | `'full'` | `'full'`, `'light'`, or `'browser'` — see the table below.             |
| `methods`               | all      | Exact-match root filter, as above.                                     |
| `withArguments`         | `false`  | Bounded argument snapshots for every traced call.                      |
| `memory`                | `false`  | Per-call Chromium heap deltas.                                         |
| `cpu`                   | `true`   | Long-animation-frame blocking, falling back to long tasks.             |
| `browser`               | on       | Browser signal sources; see below.                                     |
| `captureAsyncContext`   | `true`   | Stack-based links across `await`. Disable for lower-overhead captures. |
| `lightWindowMs`         | `1000`   | Light mode aggregation window.                                         |
| `maxFunctionsPerWindow` | `80`     | Light mode functions retained per window.                              |
| `maxLightWindows`       | `1800`   | Light mode window budget.                                              |

### Modes

| Capability                                             | Full                   | Light                    | Browser |
| ------------------------------------------------------ | ---------------------- | ------------------------ | ------- |
| Call frames, parent links, rays, markers, ray metadata | Yes                    | No                       | No      |
| Function counts, errors, total/min/max duration        | Yes                    | Yes                      | No      |
| Time alignment                                         | Individual call starts | Bounded function windows | No      |
| Browser signals                                        | Yes                    | Yes                      | Yes     |
| Custom extension samples                               | Yes                    | Yes                      | No      |

Light mode suits long or frequent interactions:

```ts
await recordSession('Mouse movement', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'light',
  lightWindowMs: 1000,
  maxFunctionsPerWindow: 80,
  maxLightWindows: 1800,
  browser: { maxSamples: 20000, sampleIntervalMs: 1000 },
});
```

Overflow within a window goes to `otherCalls` and `otherDuration`; exhausted
window and sample budgets increment dropped counters. These are per-window
bounds, not whole-file limits — aggregates and custom extensions still add data.

Browser mode measures the same interaction without installing recording-scoped
method wrappers:

```ts
await recordSession('Mouse movement, browser signals only', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'browser',
  browser: { sampleIntervalMs: 1000 },
});
// Perform the interaction, then call releaseSession().
```

Existing explicit `trace` and `@Trace` wrappers still make pass-through calls, so
compare sessions from the same application build to keep baseline overhead
consistent.

## Browser signals, arguments, and memory

`cpu` is a responsiveness signal, not process CPU utilization. Browser capture
includes available event timing, frame rate, layout shifts, resource timing,
visibility, timer lag, and memory estimates. Configure sources independently
through `browser`, and inspect `browserCapabilities` to tell unsupported,
disabled, and failed capture apart from zero observations. CPU pressure is
experimental and opt-in. Event Timing does not capture continuous pointer motion.

`withArguments` and `memory` are both off by default. Treat captured arguments
and metadata as shareable only when appropriate for their contents.

Every `at` value is milliseconds since `timelineOrigin`, a monotonic timestamp.
`startedAt` is a wall-clock display date, not an alignment key. Total function
time is inclusive and overlaps across nested calls.

## Full captures without async stack recovery

For CPU-throttled investigations, pass `captureAsyncContext: false` to skip
stack-based ancestry recovery:

```ts
await recordSession('Throttled drag', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'full',
  captureAsyncContext: false,
});
```

Synchronous child links, call durations through promise settlement, and errors
are still recorded. Calls after an `await` become independent roots, and markers
outside an active synchronous trace no longer attach to an async parent.
Existing captures keep async ancestry by default. The disabled setting is
recorded on the `tracing.configuration` extension channel, including for
streamed sessions.

Disabling async context does not bound recording memory — full capture still
retains event data until release. Compare against browser-only mode to measure
application responsiveness without function tracing.

## Taking part in a recording

Another layer can contribute to whatever recording is active by registering a
collector, rather than wrapping or replacing the entry points above:

```ts
import { registerTraceCollector } from '@sx/recordings';

registerTraceCollector({
  name: 'my-repo.selection',
  onStart: (state, options) => startSampling(options),
  onStop: () => stopSampling(),
});
```

Collectors run for every recording regardless of which entry point started it,
any number can be registered side by side, and one that throws is recorded as
data instead of breaking the capture. See
[Extending](./EXTENDING.md#take-part-in-every-recording).

## Platform cache capture

The Platform dev-tools service registers a collector that samples Platform
cache sizes. Its snapshots are captured for any recording once that service is
loaded, including recordings started straight from this package.

## Changes

See [CHANGELOG.md](./CHANGELOG.md) for unreleased integration notes.
