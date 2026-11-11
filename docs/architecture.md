# Architecture

[Documentation index](./README.md)

```text
consumer application
  @sx/recordings ──depends on──> @sx/tracing
       │                           │
       │ sessions + batching       └─ capture runtime, collectors, public types
       ▼
  @sx/dashboard/server → JSONL recordings + derivative query index
       ▲
  @sx/dashboard/data ← default UI or consumer React dashboard
```

## Boundaries

- **Tracing** owns instrumentation, capture state, browser signals, error
  snapshots, collectors, and the recording types. It imports no dashboard,
  networking transport, or React runtime.
- **Recordings** owns session startup/shutdown and upload. It re-exports tracing
  so consumers can use one import while retaining the same shared capture state.
- **Dashboard** owns generic storage, parsing, queries, default UI, and extension
  slots. `/data` and `/server` work without installing React. The standalone UI is
  prebuilt; embedding components requires the declared React peers.
- **Original libraries** (`tracer`, `runtime-context`) remain independent and
  are not compatibility aliases for the new tracing package.

## Lifecycle

Instrumentation is installed at definition time when the URL flag is active.
`startRecording` begins in-memory capture; `recordSession` additionally starts the
transport and waits for the server. Updates are queued and uploaded in batches.
`releaseSession` ends capture, includes closing/decorated samples, flushes the
remaining data, and finishes server storage. A failed start rolls back the
recording it started. A failed final upload rejects; this is not an offline queue.

The wire recording schema is version 1. Runtime and transport singleton keys use
version 2 identifiers; these are different version concepts. Compatible duplicate
imports share state through global symbols within one realm.

## Extension ownership

Consumers own channel and metadata-owner names, schemas, validation, analysis,
and UI. Prefer a prefix such as `shop.cache`. The core stores unknown sample
payloads without interpreting them. Top-level collector decoration is useful for
local projections; persisted custom data belongs in extension samples or metadata.

UI customization is explicit: consumers pass an extension configuration, compose
feature arrays, and resolve conflicts. Core defaults remain when no customization
is provided. Consumer pages are not hidden based on application-specific IDs.

## Reading large recordings

Saved sessions expose summaries and paged queries. Raw sample arrays missing
from a summary mean “not loaded”, not zero. Fetch a channel through
`sessionClient.samples`; explicitly load complete data only when needed.

JSONL is the source recording. SQLite indexes are derivative query data, not a
replacement for it. Standalone HTML exports contain bounded summaries and optional
consumer projections; they deliberately exclude raw call payloads. See
[dashboard data and exports](../packages/tracing/DASHBOARD.md) and
[extension projections](../packages/tracing/EXTENDING.md#standalone-export-data).
