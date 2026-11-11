# Extending tracing and the dashboard

Custom telemetry is two halves of one pipeline. The recorder has no opinion about
your data: you emit it on your own channel, and the dashboard renders it through
an extension slot. Neither half requires a change to the recorder or the server.

1. **[Emit custom data](#part-1--emit-custom-data)** with ray metadata, markers,
   or extension samples from `@sx/recordings`.
2. **[Render it](#part-2--render-custom-ui)** as a dashboard block, column, or
   page from `@sx/dashboard`.

Read part 1 first even if you only want UI work: a block can only show what the
recorder captured, and the channel name you choose in part 1 is the key you read
in part 2.

## Part 1 — Emit custom data

### Attach metadata to a ray

See [extra data per tracing ray](../../docs/examples/ray-metadata.md) for complete
examples of concurrent operations, independent consumers, and dashboard queries.

Metadata describes the logical operation. Markers describe something that
happened at a particular time within it.

```ts
import {
  getActiveTraceRay,
  marker,
  setTraceRayMetadata,
  trace,
} from '@sx/recordings';

export const resize = trace(
  async (componentId: string) => {
    const ray = getActiveTraceRay();
    setTraceRayMetadata('editor-platform.context', {
      version: 1,
      componentId,
      operation: 'resize',
    });
    marker('layout-requested', { componentId });

    await Promise.resolve(); // Replace with the application's async operation.
    setTraceRayMetadata('editor-platform.result', { applied: true }, ray);
  },
  'Component.resize',
  { namespace: 'editor-platform' },
);
```

Capture a handle at the start of the traced callback and pass it explicitly after
`await`, in timers, or in external callbacks. `getActiveTraceRay()` deliberately
uses the synchronous active stack; it does not guess async ownership.

`setTraceRayMetadata(owner, data, handle?)` replaces that owner's value and leaves
other owners intact. Omit the handle only while synchronously inside a traced
call. It returns false when there is no applicable ray, capture has ended, the
handle belongs to a previous session, or capture is light mode.

Owners must match `[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}`. Data must serialize as JSON;
a call snapshots it immediately. The encoded value may be at most 16 KiB and a
ray supports at most 32 owners. Invalid payloads/owners throw. Repeated updates
remain in the stream, so avoid writing metadata every frame.

Released and parsed recordings expose:

```ts
recording.traces[0].metadata?.['editor-platform.context'];
```

Streaming encodes updates on the reserved `tracing.ray-metadata` extension
channel. The dashboard parser replays these updates onto each ray; last update
for the same owner wins. Unknown owners require no server changes. Metadata is
included in JSON, JSONL, and standalone HTML reports. The default frame inspector
shows the selected ray's metadata. Do not publish samples on the reserved channel
from application code.

### Emit markers

`marker('cache-hit', { key: 'safe-key' })` adds a timestamped event with the active
call's parent ID, namespace, and ray. Emit markers synchronously inside traced
code. Marker payloads are not automatically snapshotted: pass small immutable,
JSON-safe values. Full mode is required for retained markers.

### Emit independent observations

```ts
import { addTraceExtensionSample } from '@sx/recordings';

addTraceExtensionSample('editor-platform.selection', {
  version: 1,
  selectedCount: 3,
});
```

The recorder adds the shared-clock `at` timestamp. This works in full and light
mode; it is a no-op outside capture. Samples are independent of a ray. If needed,
include a captured ray ID in your payload explicitly. Samples are preserved
without app-specific interpretation. They are not automatically snapshotted or
size-limited; use immutable JSON-safe payloads and bounded sampling.

The channel owner provides the schema, validation, analysis, and dashboard
extension. For custom per-function columns, collect markers by their `parent`
call and key results by both function namespace and name, never by name alone.

### Take part in every recording

The calls above emit from inside your own code. When a layer instead needs to
contribute for the whole of any recording -- sampling something periodically,
or attaching a closing measurement -- register a collector.

```ts
import { registerTraceCollector } from '@sx/recordings';

const unregister = registerTraceCollector({
  name: 'my-repo.selection',
  onStart: (state, options) => startSampling(options),
  onStop: () => stopSampling(),
  decorate: (recording) => ({ ...recording, selectionCount: count(recording) }),
});
```

| Hook       | When it runs                                                        |
| ---------- | ------------------------------------------------------------------- |
| `onStart`  | Once capture has started, with the recording state and its options. |
| `onStop`   | While the session is still active, so a closing sample is retained. |
| `decorate` | After the recording is assembled, to add derived fields.            |

Collectors are the supported way for code outside this package to extend a
recording. Do not assign onto `globalThis.__EDITOR_TRACING__`: whichever module
is evaluated last would win, and a second extension would silently replace the
first.

Every collector takes part in every recording, whichever entry point started it
-- a direct `startRecording` import, a service wrapper, or the console global --
so the captured data no longer depends on how recording was triggered. Any
number of repositories can register alongside each other; `name` identifies a
collector, and registering the same name again replaces the earlier one. The
returned function unregisters.

`onStart` and `onStop` run in registration order, and `decorate` is applied in
that order too. A collector that throws is recorded on the reserved
`tracing.collector-error` channel and the recording continues, so one broken
extension cannot take the capture down.

Custom top-level fields returned by `decorate` are local projections, not part
of the streaming storage schema. For data that must survive upload, JSONL export,
and paged reads, append namespaced `extensionSamples` in `decorate`, emit them
from `onStop`, or use ray metadata. Keep the original sample objects when
appending so transport deduplication retains the already-streamed samples once.

The [cache collector example](../../docs/examples/cache-extension.md) starts
counting on `onStart` and emits a closing sample on `onStop`.

## Part 2 — Render custom UI

Customize the UI in the consuming application, then serve its built assets with
the shared server. Extension code executes as ordinary React code in that build.
No changes to the recorder or server are needed to render a custom data channel.

### Add overview blocks and table columns

```tsx
import {
  DashboardApp,
  useDashboard,
  type CoreDashboardExtensions,
} from '@sx/dashboard';
import '@sx/dashboard/style.css';

function SelectionOverview() {
  const { analysis, selectedTimeBucket, selectTimeBucket } = useDashboard();
  return (
    <section className="cd-card">
      <h2>Execution health</h2>
      <p>
        {analysis.errors} errors; selected time slice {selectedTimeBucket + 1}
      </p>
      <button onClick={() => selectTimeBucket(0)}>
        Select first time slice
      </button>
    </section>
  );
}

const extensions: CoreDashboardExtensions = {
  overviewBlocks: [{ id: 'platform.selection', component: SelectionOverview }],
  functionColumns: [
    {
      id: 'platform.error-rate',
      label: 'Error rate',
      render: (item) =>
        `${Math.round((100 * item.errors) / Math.max(1, item.calls))}%`,
      sortValue: (item) => item.errors / Math.max(1, item.calls),
    },
  ],
};

export function App() {
  return <DashboardApp extensions={extensions} />;
}
```

Blocks and columns appear in array order. `sortValue` enables sorting by clicking the column header. `render` receives the same function summary as
the built-in columns. Validate custom sample payloads before reading their fields.
For app-specific counts, build an index once per recording, keyed by
`functionKey(namespace, name)`; take active root filters into account when needed.

Additional additive slots are `overview`, `problems`, `toolbarActions` (React
nodes) and `frameDetails(event)` (a renderer). These remain useful for simple
content. React components in any slot can call `useDashboard`.

### Replace, hide, or wrap a block

```tsx
import {
  type CoreDashboardExtensions,
  useDashboard,
} from '@sx/dashboard';

function MyTimeline() {
  const { recording } = useDashboard();
  return <section>Custom timeline for {recording.duration} ms</section>;
}

export const extensions: CoreDashboardExtensions = {
  blocks: {
    'overview.timeline': MyTimeline,
    'overview.browser-signals': false,
    'overview.metrics': ({ children }) => (
      <div className="my-metrics-wrapper">{children}</div>
    ),
  },
};
```

A replacement receives the default block as `children`. Render it to wrap the
core behavior; omit it to replace the block completely. `false` hides a block.
Available stable IDs:

- `overview.metrics`
- `overview.timeline`
- `overview.browser-signals`
- `functions.table`
- `frames.inspector`

### Replace or add whole pages

```tsx
import {
  useDashboard,
  type CoreDashboardExtensions,
} from '@sx/dashboard';

function Diagnostics() {
  const { recording, navigate } = useDashboard();
  return (
    <section>
      <h2>Diagnostics for {recording.title ?? recording.sessionId}</h2>
      <button onClick={() => navigate('functions')}>Inspect functions</button>
    </section>
  );
}

export const extensions: CoreDashboardExtensions = {
  pages: {
    overview: ({ children }) => (
      <>
        <p>Our editor's overview</p>
        {children}
      </>
    ),
    problems: false,
  },
  additionalPages: [
    {
      id: 'platform.diagnostics',
      label: 'Diagnostics',
      subtitle: 'Application-specific observations',
      component: Diagnostics,
    },
  ],
};
```

Built-in page IDs are `overview`, `problems`, `functions`, and `frames`.
Replacements retain the shell, title, toolbar, and state. `false` removes a page
from navigation. Additional pages follow the built-in pages in array order. Their IDs and
visibility belong to the consumer: even a page called `caches` remains available
in browser mode. Omit a page from `additionalPages` when your consumer cannot
provide its data in the current mode.
There must be at least one visible page. Duplicate page IDs (including built-in
IDs) overview-block IDs, or function-column IDs throw, rather than silently discarding an extension.

Use one explicit configuration object. If several features contribute extensions,
compose their arrays deliberately and decide conflicting replacements in your
application. There is no implicit priority or last-plugin-wins registry.

### Shared state and reusable components

`useDashboard()` exposes:

- `recording`, common `analysis`, `dataScope`, optional `sessionClient` and `loadRecording`;
- `page`, `navigate(pageId)`;
- `selectedTimeBucket`, `selectTimeBucket(index)`;
- `selectedRay`, `selectRay(rayId)`, `selectedFrame`, `selectFrame(frameId)`;
- function `query`/`setQuery` and `root`/`setRoot` filters.

Time selection indexes the 48 shared timeline buckets. The selected interval is
`[index / 48 * duration, (index + 1) / 48 * duration)`. Browser signals, the core
timeline, and extensions share this selection. Light windows are coarser than
individual calls; do not imply exact per-call alignment.

The package also exports `Overview`, `Problems`, `Functions`, `Frames`,
`FrameInspector`, `Timeline`, and `CoreBrowserSignals`. Their TypeScript props
describe their inputs. `Overview` uses dashboard context; replacements normally
reuse its default `children`. For a completely separate UI, use the `/data` entry
point and your own state, or explicitly provide `DashboardContextProvider` and
`DashboardCustomizationProvider` when composing context-aware core components.

### Load extension data without loading every trace

In `DashboardApp`, saved sessions use `dataScope: 'summary'`. The context's
`recording` contains metadata, with empty `traces` and no raw sample arrays.
Use `analysis` for totals and function columns. Do not treat absent raw data as
zero observations. A direct `CoreRecordingDashboard` with a complete recording,
an imported file uses `dataScope: 'complete'`. Standalone exports use `dataScope: 'summary'` with `traceDataExcluded: true`.

Use the paged client for a custom channel, cancelling work when the block unmounts:

```tsx
import { useEffect, useState } from 'react';
import { useDashboard } from '@sx/dashboard';

function SelectionCount() {
  const { recording, sessionClient } = useDashboard();
  const [count, setCount] = useState<number>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setCount(undefined);
    setError('');
    if (sessionClient) {
      sessionClient
        .samples(
          recording.sessionId,
          'editor-platform.selection',
          0,
          controller.signal,
        )
        .then((page) => {
          if (!controller.signal.aborted) setCount(page.total);
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(String(failure));
        });
    } else {
      setCount(
        (recording.extensionSamples ?? []).filter(
          (sample) => sample.channel === 'editor-platform.selection',
        ).length,
      );
    }
    return () => controller.abort();
  }, [recording, sessionClient]);
  return (
    <p>
      {error ||
        (count === undefined
          ? 'Loading observations…'
          : `${count} selection observations`)}
    </p>
  );
}
```

`sessionClient.frames(id, { ray, frame }, signal)` provides a selected frame plus
ray metadata without loading other rays. Within the remote inspector, context
`selectedFrame` and `selectedRay` reflect the loaded inspector selection. Outside
that inspector, use the URL selection and paged client; raw frames are not loaded
merely because an overview extension reads context.

If an extension genuinely needs the entire recording, explicitly call
`await loadRecording?.(signal)` and release that result when its page unmounts.
This opts back into full-recording memory use. Avoid doing it automatically for
small badges or summary cards.

### Router integration

`DashboardApp` uses `/sessions/:id/:page`, including additional page IDs. Calling
`navigate('platform.diagnostics')` updates the URL and supports Back/Forward.
Use `CoreRecordingDashboard` to integrate another router:

```tsx
<CoreRecordingDashboard
  recording={recording}
  navigation={{
    state: { page: 'functions', query: 'resize', root: '' },
    onChange: (view, replace) => updateYourRouter(view, replace),
    href: (view) => yourPageUrl(view),
  }}
  onOpen={showSessions}
  onRefresh={refresh}
  onCompare={compare}
/>
```

`DashboardViewState` also contains `bucket`, `ray`, `frame`, `rayOffset`,
`frameOffset`, `rayQuery`, and `frameQuery`. Keep URL state serializable; do not put
recording objects in history state. The optional `summary`, `functionAnalysis`,
`sessionClient`, and `loadRecording` props support custom hosts using the same
server projections as `DashboardApp`. `functionAnalysis` supplies root-filtered
function costs while `summary.analysis` keeps session-wide totals.

### Drill into core analytics from an extension

Use `context.inspectFrames?.({ namespace: 'Editor', name: 'render',
minDuration: 16, sort: 'duration' })` to navigate to filtered calls.
Other supported filters include `kind`, `from`, `to`, `ray`, `parent`, and `root`.
The core explorer preserves these in its URL and applies them on the server.
`context.selectedFunction` and `context.selectFunction?.(functionId)` expose the
function drawer selection. Keep custom payload inspection inside the
`frames.inspector` block: its context includes the selected full frame and ray.

The paged data client accepts the same frame filters:

```ts
const page = await client.frames(
  sessionId,
  {
    namespace: 'Editor',
    name: 'render',
    minDuration: 16,
    sort: 'duration',
    offset: 0,
    // Fetch a full payload independently of the current ray filter:
    frameRay: selectedRayId,
    frame: selectedFrameId,
  },
  signal,
);
```

Sort values are `time`, `time-desc`, `duration`, and `duration-asc`.
`from` is inclusive and `to` is exclusive. Avoid requesting complete recordings
for table columns; use compact frame fields or fetch selected payloads on demand.

### Filtered analytics, progress, and lazy trees

`sessionClient.analytics(id, filters, signal)` returns `functions`, `counts`,
`bucketMs`, and `total`. It accepts the frame filters, including `from`, `to`,
`namespace`, `name`, `minDuration`, `maxDuration`, `query`, `kind`, and `root`.
`counts` is bounded to 120 buckets, with a minimum bucket width of one second.
Use this API for call-density overlays instead of loading raw calls.

`sessionClient.frames(id, { ray, rootsOnly: true }, signal)` pages root calls;
`{ ray, parent: frameId }` pages immediate children. Fetch descendants only when
expanded. For a complete-data import the core provides equivalent local queries.

`sessionClient.progress(id, signal)` reports preparation `phase`, `bytes`, and
`totalBytes`. Poll only while the summary request is pending; cancel polling when
leaving the session. `useDashboard().navigation` exposes the current serializable
view and `onChange`; `browserSummary` provides bounded browser-signal series.

### Consumer-owned server projections

A consumer can install its own Vite middleware beside `recordingsServer()` for
application-specific aggregates. Keep those endpoints and schemas in the consumer;
do not import this package's private storage index. A consumer can stream recordings and return compact, filtered aggregates
through its own projection endpoint.

`DashboardApp` accepts `onRouteChange(route: DashboardRoute)`. Use a stable callback
(e.g. a state setter) to observe session/filter changes, cancel obsolete projection
requests, and rebuild your `extensions` object with the new column values. The
callback runs after navigation, including initial load and browser history.
Use the `extensions(recording)` factory for complete-data imports. For standalone
reports, restore embedded extension projections as described below; do not fetch
a saved-session projection for a local recording.

Resolve **public built exports** rather than private source files. In a
consumer, install the dashboard and configure its public Vite adapter. External editors use ordinary `@sx/dashboard`
imports with the same APIs and their own extension configuration.

#### Standalone export data

`DashboardApp` accepts an `exportData(recording, summary, signal)` callback for
host-owned projections. Return a JSON-serializable object containing the data
required by every extension page, not only the currently visible page. For saved
sessions, fetch compact projections using the supplied abort signal; do not load
raw recordings or loop over per-function/per-root endpoints. Use one bulk
projection request per extension. The HTML embeds the host's compiled application and styles.

Use `readStandaloneSnapshot()?.extensions` to restore those projections in your
host and avoid server requests when opened offline. The Platform viewer provides
a working example including cache storage and per-function outcomes. Core exports
retain summary charts, function statistics and grouped call paths, excluding raw
frames, arguments, results, errors and ray metadata. Trace-dependent filters and
individual-call navigation are unavailable offline.

## Consumer cache data example

For both application and dashboard code, see the [complete cache extension walkthrough](../../docs/examples/cache-extension.md).

```ts
import { addTraceExtensionSample, registerTraceCollector } from '@sx/recordings';

const unregister = registerTraceCollector({
  name: 'my-app.cache',
  onStop: () => addTraceExtensionSample('my-app.cache', {
    version: 1, hits: 12, misses: 3,
  }),
});
// Call unregister() when the consumer integration is disposed.
```

Use a consumer-owned overview block or page to render this channel. For a complete
recording, read `recording.extensionSamples`. For a saved summary, call
`sessionClient.samples(recording.sessionId, 'my-app.cache', offset, signal)` and
page through the results if needed. Validate the payload's `version` and fields
before reading them. Derive totals in the consumer, or expose a consumer-owned
projection endpoint for large datasets. The core never interprets custom channels
as cache hits, queue sizes, or another application's domain model. Browser-only
capture does not record extension samples; full and light captures do.
