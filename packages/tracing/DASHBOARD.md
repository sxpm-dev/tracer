# Dashboard and recording server

`@sx/dashboard` is the viewing half of tracing: the core
React dashboard, UI-independent recording APIs, a local recording server, a
command-line launcher, and a Vite adapter. The recorder itself is
[`@sx/recordings`](./README.md).

Installing and launching the dashboard is covered in the
[recorder README](./README.md#start-the-dashboard). This document covers what
you can do beyond running the default UI.

## Run the default dashboard

Install the packages from npm:

```sh
yarn add --dev @sx/dashboard
yarn trace-dashboard --port 4178
```

Use Node 22.14 or newer; this repository uses the version in [`.node-version`](../../.node-version). Open
`http://127.0.0.1:4178`, then point the tracing library's `recordSession` at that
URL. The home screen lists recorded sessions automatically. Use Refresh sessions
to pick up new recordings. The server defaults to
`.recordings` in the launching directory and binds to loopback.

```sh
yarn trace-dashboard --recordings ./local-traces --port 4178
```

The default UI supports saved sessions, JSON/JSONL file import, Overview,
Problems, Functions, Trace frames, light/dark themes, and standalone HTML export.
Saved sessions also support generated performance reports; select multiple
recordings on the sessions screen for a configurable comparison. See
[Performance reports](./PERFORMANCE_REPORTS.md) for the UI, CLI, configuration,
formulas, capture limits, and evidence bundle.
Its comparison view compares call rates, errors, and browser blocking between a
baseline and candidate, retaining only baseline metrics.
The Platform application's existing richer comparison remains available there.

## Run from this repository

From the root, build dependencies and the default UI, then start the CLI:

```sh
yarn build
yarn start:dashboard --port 4178
```

Use the Node version in `.node-version`. Consumers build their own extensions
through the public [extension API](./EXTENDING.md); see the
[cache example](../../docs/examples/cache-extension.md).

## Sessions and navigation

The home screen shows searchable, filterable sessions with capture mode, status,
duration, event/call count, file size, and recording date. Open a session to visit:

- `/sessions/:sessionId/overview` — totals, activity, browser signals, and findings.
- `/sessions/:sessionId/problems` — errors, slow calls, and browser blocking.
- `/sessions/:sessionId/functions` — searchable/sortable costs and root filters.
- `/sessions/:sessionId/frames?ray=…&frame=…` — paged rays, frames, and an inspector.

Root filters, function search, timeline selection, ray/frame searches, and page
offsets are URL parameters. Browser Back/Forward and reload restore these values;
links can open in another tab. Custom page IDs get the same URL behavior.
Use **All sessions** to return home and release session data. **Compare** saves
only summary metrics, then lets you choose a candidate.

Imported files use `/local/:page`; they are not uploaded. Reload requires reopening
the file. Exported standalone reports use hash URLs and carry their own data.

## Large recordings

URL navigation enables restoring a view; scoped loading is what reduces memory:

- The home screen fetches metadata only.
- Saved-session analytics fetch function/root aggregates and 48-bucket charts;
  they do not download event arrays, arguments, or custom sample payloads.
- Frames fetch 100 rows per page. Only the selected frame includes its full payload.
- Leaving a page cancels its requests and releases its data. There is no cache of
  previously opened recordings or frame pages in the application.

The first request builds a persistent SQLite index in `.dashboard-index/` beside
recordings. It scans JSONL incrementally, caches summaries, and indexes scalar
frame fields and payload byte offsets. Later requests query the index and read
only selected payloads. Indexes rebuild when the source size, modification time,
or recording metadata changes. Live requests use a completed append snapshot.
The original files are never rewritten; legacy absolute event clocks are
normalized when read.

Index creation needs disk space and time. On one local 561 MB recording with
2.76 million events, initial preparation took about 14 seconds; warm summary,
ray-page and frame-page requests took 9 ms, 26 ms and 3 ms respectively. The
summary response was 282 KB, peak server RSS about 358 MiB, and the derivative
index 817 MiB. These are local measurements, not performance guarantees.
Memory during preparation scales with unique functions/rays and the largest
JSONL record. Text searches and filtered counts can still scan indexed rows.
You can remove `.dashboard-index/` while the server is stopped to reclaim space;
it will be rebuilt. Deleting a session also deletes its index.

Imported JSON/JSONL files and standalone reports remain in browser memory. Browser
imports are limited to 32 MiB. Open larger recordings through the local server:
charts and tables use bounded queries against server-side indexes, without storing
raw logs in IndexedDB. Deleting a recording also removes its derived core index;
hosts can use `onRecordingDeleted` to remove extension indexes.

**Export HTML** works with large saved sessions by embedding dashboard summaries,
browser charts, findings, and each function’s grouped call paths instead of raw
traces. The exported file runs the same dashboard offline, including host-provided
extension data. Individual-call browsing and filters requiring raw calls are
unavailable in exports; function search, sorting, details, and call paths remain
available. Export uses one core request with streamed progress plus optional consumer-owned bulk projection requests; Cancel export aborts the in-flight request. Shared
call-path segments are stored once across functions and roots.

## Public entry points

| Import                                             | Use                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `@sx/dashboard`           | React application, core dashboard, blocks, hooks, data APIs, HTML export |
| `@sx/dashboard/style.css` | Styles for imported React components                                     |
| `@sx/dashboard/data`      | Recording types, parser, HTTP client, analysis; no React runtime         |
| `@sx/dashboard/server`    | Node server and recording middleware; no React runtime                   |
| `@sx/dashboard/vite`      | Optional Vite recording-server plugin                                    |

The package ships ESM and CJS builds with declarations. React 18 and ReactDOM 18 are optional peers required for imported UI components;
Vite is an optional peer needed only for the Vite adapter. The CLI and server
serve the already-bundled default UI without needing React installed separately. Browser entry points
must not import the Node server entry point.

## Embed and customize

```tsx
import { DashboardApp } from '@sx/dashboard';
import '@sx/dashboard/style.css';

export function App() {
  return <DashboardApp serverUrl="http://127.0.0.1:4178" />;
}
```

`DashboardApp` owns the browser URL, file/session loading, and errors. Mount it at
the origin root; the host must serve the app for `/sessions/*` and `/local/*`.
The included server and Vite dev server support these routes. Supply `extensions`
as an object or `(recording) => extensions`. Saved-session `recording` contains
metadata only; use shared `analysis` and the paged client for data (see [Extending](./EXTENDING.md)). `initialRecording` opens an already loaded recording.

Use `CoreRecordingDashboard` when your application owns loading and navigation:
pass `recording`, `onOpen`, `onRefresh`, `onCompare`, and optional `extensions`.
Its optional `navigation: { state, onChange, href }` integrates with your router;
without it, the component keeps local navigation state.
See [Extending](./EXTENDING.md) for additions and replacements.

## Run the server programmatically

```ts
import { startRecordingServer } from '@sx/dashboard/server';

const server = await startRecordingServer({
  port: 4178,
  recordingsDirectory: './local-traces',
  // Omit to serve the default packaged UI:
  dashboardDirectory: './my-dashboard/dist',
});
// Later: server.close();
```

`dashboardDirectory` must contain a built `index.html` and its assets. Omitting it
uses the included default dashboard. There is no separate server implementation
to copy into another repository. `port: 0` lets the OS allocate a port, available
through the returned Node server's `address()`.

For an existing Node server, mount `createRecordingMiddleware(options)` with
`(request, response, next)`. For consumer development with Vite:

```ts
import { defineConfig } from 'vite';
import { recordingsServer } from '@sx/dashboard/vite';

export default defineConfig({
  plugins: [recordingsServer({ recordingsDirectory: './local-traces' })],
  server: { port: 4178 },
});
```

The adapter adds the recording routes in dev and preview. Vite serves the
consumer's UI, which imports the dashboard package and registers its extensions.

## Use the data without our UI

```ts
import {
  analyzeCoreRecording,
  createRecordingClient,
  parseRecording,
  parseRecordingJsonl,
} from '@sx/dashboard/data';

const client = createRecordingClient('http://127.0.0.1:4178');
const sessions = await client.list();
const recording = await client.load(sessions[0].sessionId);
const analysis = analyzeCoreRecording(recording);
console.log(analysis.functions, recording.traces[0]?.metadata);
```

For large saved recordings, use the paged client instead:

```ts
import { createSessionClient } from '@sx/dashboard/data';

const client = createSessionClient('http://127.0.0.1:4178');
const controller = new AbortController();
const summary = await client.summary(sessionId, '', controller.signal);
const rays = await client.rays(sessionId, 0, '', controller.signal);
const frames = await client.frames(
  sessionId,
  {
    ray: rays.items[0].ray,
    offset: 0,
    frame: selectedFrameId, // optional: fetch this frame's full payload
  },
  controller.signal,
);
// On page/session change:
controller.abort();
```

`summary.analysis.rays` is empty; use `rays()` to enumerate them. `summary.recording`
is metadata with empty traces, not a complete export. `summary(id, root, signal)`
can filter function statistics by root. `rays` and `frames` return `items`, `total`,
and `offset`, with a fixed maximum of 100 items; frame search applies to the whole
ray, not just the current page. `samples(id, channel, offset, signal)` pages a
custom extension channel. `createRecordingClient.load(id, onProgress, signal)`
remains the explicit full-recording API.

`parseRecording(text)` accepts a released JSON object. `parseRecordingJsonl(text)`
and `parseRecordingJsonlStream(stream, onBytes)` read streamed sessions. The
client has `list`, `load`, `remove`, and `clear` methods. `clear` empties an active
session; `remove` deletes a completed session. Both are explicit mutations.

Build any UI over `TraceRecording` and the analysis output. You do not need to
mount the core dashboard or use its navigation and styles.

## Portable HTML

`downloadStandaloneHtml(recording)` embeds the current compiled dashboard and
recording. `createStandaloneHtmlBlob(recording, onProgress, { javascript, css })`
allows supplying the compiled assets explicitly. Extensions are included when
compiled into that application, not serialized as React functions in the data.

Use a self-contained single JS bundle for portable reports, with dependencies
bundled and dynamic imports inlined (`build.rollupOptions.output.inlineDynamicImports`
in a single-entry Vite build). Unbundled chunks or external assets will not be
embedded automatically. During development, the exporter falls back to
`dist/index.html`; build the consumer UI first. The packaged default dashboard
already has a self-contained bundle.

See [Guidelines](./GUIDELINES.md) for compatibility and extension ownership.

## Analytics interactions

Every page shares the same navigation, typography, surfaces and light/dark theme.
Charts expose exact values on hover or keyboard focus; their legends toggle
series. Select an activity interval to explore its frames. Functions support
numeric column sorting, search, error filtering and a details drawer with links
to matching calls. Frame exploration supports all rays or a selected ray,
function, event type, minimum duration, time interval and parent filters, plus
start-time/duration sorting. Row inspection opens a drawer with the full payload,
ray metadata, parent navigation and child-call drilldown. Lists use bounded pages.

Saved-session filters and frame/function selections are shareable URL state.
Back/forward and refresh restore the selected view. Dialogs support Escape,
keyboard focus containment and return focus to the initiating control.

## Time-range exploration and call trees

Functions and Trace frames share the session timeline. Click a start interval and
then an end interval, or enter exact From/To milliseconds, to filter the results.
The interval uses call start time: `from <= start < to`. Namespace and function
filters match exact names; search supports partial names. Minimum/maximum duration
filters apply to individual calls before function statistics are aggregated.

Open a function or call inspector to see the recording charts on the left and
details on the right. A single call has an exact start marker. Aggregated functions
use one-second buckets, expanded for long recordings to at most 120 marks. Browser
signal charts use the same markers. No per-call array is sent for these overlays.

Trace frames uses one table with controls above it. Choose **View call tree** to
show a ray's root calls, then expand the arrows to load nested children. Each level
loads at most 100 rows per page. The tree restores full parent/child context; it
clears the table filters on entry. Child expansion is local UI state; the selected
ray, tree mode, filters, and inspector remain in the URL.

The preparation screen reports bytes extracted and extraction percentage, followed
by named indexing/analytics stages. These final stages are indeterminate rather
than an estimated overall percentage. Cached recordings skip extraction.

## Explore sample recordings

Select **Open sample data** on the sessions screen, or open
`/sample/full/overview` on your dashboard server. **Lightweight sample** opens
`/sample/light/overview`. Both URLs support reloads, page navigation, filters,
and inspector links without a saved recording or browser capture permissions.

The full sample is deterministic synthetic data: all 12 browser metrics,
main-thread blocking with script attribution, CPU pressure levels, heap and
browser-memory samples, positive and negative per-call heap changes, nested
calls across namespaces, arguments, errors, markers, ray metadata, and an
extension sample. Example result values are custom event `data`; the tracing
runtime does not automatically capture return values. The lightweight sample
demonstrates aggregate function costs, argument examples, time windows, and
runtime signals without individual call graphs.

The sample is a functional tour, not a large-recording performance benchmark.
It never writes to your recordings directory or measures your device.

Consumers can import `createSampleRecording('full' | 'light')` and decorate
the returned recording through the `DashboardApp sampleRecording` factory prop.
Keep domain-specific samples in the host package, just like domain-specific UI.
