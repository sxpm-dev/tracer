# Choosing or migrating a package

[Documentation index](./README.md)

## Original tracer versus integrated tracing

The packages coexist. `@sx/tracer` is not a spelling alias or an earlier version
of the same public API.

| Concern | `@sx/tracer` | Integrated packages |
| --- | --- | --- |
| Capture boundary | `trace.collect(callback)` | `startRecording` / `releaseRecording`, or session pair |
| Install gate | Explicit scopes | `install-tracing` URL flag before module initialization |
| Wrap a function | `trace(fn, options)` | `trace(fn, name?, options?)` |
| Nested step | `trace.step(name, fn)` | `traceStep(name, fn)` |
| Remote delivery | Consumer-written subscriber | `@sx/recordings` batched session transport |
| Dashboard schema | Original events are not the integrated recording envelope | Version-1 recording schema |
| Custom capture | Markers and subscription | Markers, ray metadata, samples, collectors |

Do not change only the import name. Adapt the lifecycle and options, then verify
errors, async behavior, and recording content. No automatic converter for original
`trace.collect` output is supplied. Keep `@sx/runtime-context` when you need its
separate ambient context API.

## Adapting the imported production implementation

The reference's combined recorder was split into two packages:

- `@sx/tracing`: capture, instrumentation, types, collectors, browser signals.
- `@sx/recordings`: the original session and transport APIs, plus tracing re-exports.
- `@sx/dashboard`: generic UI, data, server, and CLI APIs.

If existing code imports `recordSession` or `releaseSession`, use `@sx/recordings`.
Core-only callers can use `@sx/tracing`. Session methods on the console global are
installed by importing recordings; importing tracing alone does not install the
transport. Existing `__EDITOR_TRACING__` global naming is retained for compatibility.

`startTracing(...)` was a proposed convenience API; it is not implemented. Use
`recordSession` / `releaseSession` for the current source-preserving lifecycle.

Platform-specific DI services and monitoring-viewer cache projections remain
local import reference material excluded from Git. They are not installed as
workspaces or required by the generic dashboard. Reimplement your integration through the
[public extension contracts](../packages/tracing/EXTENDING.md), rather than importing
private reference paths.
