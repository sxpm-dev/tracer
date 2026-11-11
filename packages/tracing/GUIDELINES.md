# Tracing and dashboard guidelines

Rules for changing the recorder, the dashboard, or the server. They are kept
together because the wire format is a shared contract: a change on one side is
almost always a change on the other.

## Recorder

- Keep runtime capture independent of Platform services, caches, React, and Node.
  Platform-specific behavior belongs in its existing dev-tools adapter.
- Use stable names and namespaces. Instrument logical operations and useful
  functions; avoid creating a distinct function name for every entity ID.
- Put operation context in namespaced ray metadata, timed events in markers,
  and independent sampled measurements in extension channels.
- Capture a ray handle before an async boundary. Never infer ownership by
  whichever operation happens to be active later.
- Do not add per-call data to light mode. Respect bounded windows and accurately
  report dropped samples and unavailable capabilities.
- Evolve schema version 1 additively. Keep old recordings readable; breaking wire
  changes require a compatibility strategy shared with the dashboard/server.
- Keep the version-2 shared runtime/transport owner compatible across package
  copies. New APIs must participate in that owner, not private module state.
- Layers outside this package extend a recording through
  `registerTraceCollector`, never by assigning onto
  `globalThis.__EDITOR_TRACING__`. Assignment is last-writer-wins, so it makes
  behaviour depend on module evaluation order and lets one extension silently
  replace another. Only this package installs the global API, and only through
  `getGlobalTracing` and `setGlobalSessionApi`.
- Preserve errors and return values of instrumented functions. Asynchronous
  elapsed duration is not exclusive CPU time.
- Test metadata isolation, async handles, inactive/light behavior, serialization,
  multiple imports, and transport round trips when changing these contracts.

## Dashboard and server

### Ownership

Core components and analysis consume only common recording fields. Each app owns
its extension-channel schema, validation, derived indexes, and UI. The server
persists unknown channel data without app-specific interpretation. The reserved
`tracing.ray-metadata` channel is part of the shared recording contract.

The core knows nothing about any application's domain. It counts and stores
extension samples by channel without interpreting them, and carries no field
named for one consumer's concept. A count or projection that only one
application needs belongs in that application's own server plugin, next to the
rest of its UI, not behind an option on the shared middleware.

The [cache extension example](../../docs/examples/cache-extension.md) shows how a
consumer contributes data and UI through the public APIs. Consumer-specific
analytics and projections belong in the consuming application.

### Public API rules

- Keep Node, UI, and data entry points separate. `/data` works without React.
- Treat page/block/column IDs as stable API. Use app prefixes for additions.
- Keep shared recording and selection state in context; avoid parallel copies
  that cause extensions to disagree with the core timeline.
- Render unavailable capture separately from zero. Light mode cannot supply
  exact frames, rays, parent links, or latency percentiles.
- Inclusive timings overlap. Findings identify investigation candidates; they
  do not prove that a function caused a browser blocking interval.
- Validate custom data and handle missing channels and old recordings gracefully.
- Do not fork the core dashboard to customize one block; use additions,
  replacement components, or the UI-independent data API as appropriate.
- Keep heavy derivations memoized per recording and bound table rendering.
- Exported standalone HTML must embed the consumer's compiled customization.

### Server contract

The recording routes are `/api/recordings`, `/start`, `/:sessionId`,
`/:sessionId/batches`, `/:sessionId/finish`, and `/:sessionId/clear` under that
prefix. The read-only dashboard routes under `/:sessionId` are:

| Route              | Query                                  | Response                                                                          |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------------- |
| `/export`          | none                                   | one NDJSON stream of progress and a scalar-only dashboard snapshot                |
| `/report-evidence` | none                                   | one NDJSON stream of progress and typed report evidence from the persistent index |
| `/summary`         | optional `root`                        | metadata, aggregated analysis, 48-bucket browser summaries                        |
| `/rays`            | `offset`, `q`                          | up to 100 ray summaries plus total                                                |
| `/frames`          | `ray`, `offset`, `q`, optional `frame` | up to 100 compact rows, selected full frame, ray metadata                         |
| `/extensions`      | `channel`, `offset`                    | up to 100 matching extension samples plus total                                   |

Offsets are nonnegative integers. Clients should cancel requests when changing
pages. The server stops scans when the HTTP connection closes. Full JSONL download
remains `GET /:sessionId`; summary projections must never be exported as complete
recordings. Use the tracing transport and `createRecordingClient` rather than
reimplementing the wire protocol. JSONL data and metadata live on local disk.
The server is a local development tool with browser ingestion enabled; it is not
an authenticated shared hosting service. The default host is loopback.

Preserve old recordings when extending types. Test transport → storage → parser,
JSON import, metadata replay, and standalone export together. The runtime owns
the shared recording types; the dashboard must not create a divergent copy.

### Navigation and memory

- Default home is the session list. Keep recordings out of history state and
  global caches. URL state contains IDs, filters, and offsets only.
- Keep complete-data and summary-data paths explicit in extension APIs.
- Page raw lists; load heavy payloads only for the inspector. Do not accumulate
  every previous page behind a “load more” button in the server-backed UI.
- Summary browser memory scales with unique function/root counts and fixed chart
  buckets. Server query memory also scales with ray count and the largest JSONL
  record during initial preparation. Cache scalar fields and byte offsets in the
  derivative SQLite index; never copy payloads into client summaries. Budget disk
  space for indexes (they can exceed the source size). Do not treat an index as
  the source of truth. Source changes invalidate it; active recordings use a
  completed append snapshot. Do not claim constant-memory preparation.
- Local imports require complete recordings. Standalone HTML uses explicit summary
  snapshots and grouped call paths, without raw traces or ray metadata. Keep its
  excluded trace features visible as unavailable; never present a summary as a
  complete recording. Hosts supply compact extension projections via `exportData` in a bounded number
  of bulk requests, never one request per function or root. The export scans the
  core index once, interns shared call-path segments, and streams progress with
  the final snapshot over a cancellable connection.
- Test deep links, reload, history navigation, cancellation, summary/full-analysis
  parity, and late metadata updates across separate event batches.

### Shared visual and interaction conventions

Use the core shell and theme variables for every page, including extension pages.
Keep metric cards, toolbars, table headers and empty/error states consistent.
Charts need units, exact-value tooltips and keyboard access. Explain independent
series scales; never imply that normalized lines share a numeric axis. Use
bounded pages rather than accumulating rows. Row details belong in a dismissible
drawer; preserve filter context while inspecting a row. Encode navigation and
filters in URLs, and fetch payloads on demand through `sessionClient`.

Keep decorative gradients inside the navigation sidebar. Content uses flat,
neutral surfaces in both appearances, with thin dividers and one accent for
selection. Reserve warning and error colors for actual status. Avoid decorative
metric illustrations, oversized cards, and repeated page labels.

Place search and filters with their results, sort through column headers, and
keep chart controls close to the timeline. Browser-signal charts are collapsed
on explorer pages and expanded in inspectors, where timing context is the focus.
Maintain readable table density and visible keyboard focus when adding controls.
The shared shell fills its host; standalone entry points reset their own body
margin without applying a global reset to consuming applications.

Pattern references: [Carbon data tables](https://carbondesignsystem.com/components/data-table/usage/)
for toolbar and table organization, and [Atlassian navigation layout](https://atlassian.design/components/navigation-system/layout/code)
for separating navigation from the content workspace.

#### Runtime charts

Runtime charts belong to the core dashboard in every host. The overview and call
inspection show bounded, aligned bar charts (48 time buckets), with tooltips and
call timing markers. Saved recordings are summarized on the server.

Main-thread blocking sums captured blocking duration per bucket; it is not CPU
utilization. CPU pressure shows the highest captured browser pressure level in
each bucket (nominal, fair, serious, critical), only when available. Browser heap
samples are averaged; legacy per-call heap snapshots show the sampled high-water
mark. Heap snapshots describe the whole JavaScript heap, not allocations owned
by a function. Missing samples remain gaps rather than fabricated zero values.
Platform cache analytics remain a host extension.

## Build and release

From the repository root:

```sh
yarn build
yarn typecheck
yarn test
yarn test:packages
```

The three integrated packages emit ESM/CJS entry points with matching `.d.ts` and
`.d.cts` declarations. The dashboard also emits styles, CLI entry points, and the
default UI. CLIs use top-level await and are ESM-only. Archives include the
manifest's `files` entries and third-party notices; inspect them before release.

The configured registry is public npm. There is no root `validate` script or
automatic publication step. Follow the [development and release guide](../../docs/development.md)
for local archives, checks, and release preparation. Package build success does
not establish browser compatibility or publish a package.
