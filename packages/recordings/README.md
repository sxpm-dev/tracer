# @sx/recordings

Recording sessions and batched delivery built on [`@sx/tracing`](../tracing/README.md).
Re-exports the tracing API so instrumentation, collectors, and sessions share one
capture runtime. No React or Node server dependency is added to the application.

[Documentation index](../../docs/README.md) · [First recording](../../docs/getting-started.md) · [Extensions](../tracing/EXTENDING.md)

## Install and record

Use published packages when available; for this unreleased integration, use
[local archives](../../docs/development.md#local-package-archives).

```sh
npm install @sx/recordings
npm install --save-dev @sx/dashboard
npx trace-dashboard --port 4178
```

Load the application with `?install-tracing` before instrumentation modules load:

```ts
import { trace, recordSession, releaseSession } from '@sx/recordings';

const work = trace(() => 42, 'work', { namespace: 'example' });
await recordSession('Example', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'full',
});
try {
  work();
} finally {
  await releaseSession();
}
```

## Session API

| API | Contract |
| --- | --- |
| `recordSession(title, options)` | Starts capture, checks/starts the remote session, resolves with recording state. Rejects if already recording. Failed startup cancels transport and rolls back the capture it started. |
| `releaseSession()` | Ends capture, flushes remaining data, finalizes storage, and resolves with the recording. Upload failures reject. |
| `getRecordingState()` | Reads capture state without stopping it; inherited from tracing. |
| `startRecording(options)` / `releaseRecording()` | In-memory capture with no server; inherited from tracing. |

The title must be nonempty. One recording is active per JavaScript realm. Await
startup before measured work and await release before navigation. There is no
`startTracing`, `flush`, or `stop` convenience API in this version.

## Options

`recordSession` accepts all [capture options](../tracing/README.md#recording-options)
plus these transport options:

| Option | Default | Behavior |
| --- | --- | --- |
| `serverUrl` | required | Absolute HTTP/HTTPS server origin/base URL; the transport appends `/api/recordings/...`. |
| `uploadBatchBytes` | 524,288 | Target request size, clamped between 65,536 and 4,194,304 bytes. A single oversized JSONL record may exceed the target. |
| `uploadBatchCalls` | 500 | Event batching threshold, clamped between 10 and 5,000. |
| `uploadIntervalMs` | 1,000 | Flush interval, minimum 250 ms. |

Provide finite positive numeric values. Batching is not a memory cap: full capture,
custom samples, and deduplication bookkeeping remain retained until release. The
upload chain serializes sends; this is not a persistent offline queue or a
configurable retry service. Network errors surface during release; background
flush errors are also logged.

## Low-level transport API

Advanced hosts can pair their own capture lifecycle with:

- `startRecordingTransport(title, state, options)` — attach transport to an active recording state.
- `uploadRecording(recording)` — stop streaming, send the remaining tail, and finish the active remote session.
- `cancelRecordingTransport(sessionId)` — stop matching local transport; does not delete remote data or end in-memory capture.
- `hasRecordingTransport()` — check whether a local transport owner exists, not whether the server is healthy.

`uploadRecording` requires a transport already started for that recording; it is
not a general upload/import API for arbitrary saved files. Prefer the session pair
unless you need to own lifecycle coordination.

## Consumer-owned data

`registerTraceCollector`, `addTraceExtensionSample`, and `setTraceRayMetadata`
are public re-exports. Unknown channels survive streaming, storage, and paged
reads without server schema changes. Collector closing samples and appended
samples from `decorate` are included in the final upload.

Namespaced samples are available in full/light mode; ray metadata is full-mode.
Browser-only capture excludes those custom samples. Top-level fields added by
`decorate` are local projections, not streamed storage fields. Use samples or
metadata for custom data that must persist. See the [complete extension guide](../tracing/EXTENDING.md).

## Compatibility and failures

The console global remains `__EDITOR_TRACING__`; importing this package installs
its session methods. Compatible copies share runtime and transport owners within
one realm. They do not coordinate separate windows, workers, or processes.

Instrumentation preserves application errors. Releasing a session can independently
fail, so callers that must retain the original error should record both failures
explicitly. See [troubleshooting](../../docs/troubleshooting.md) and
[how stack recovery works](../../docs/how-tracing-works.md).

## Changes

See [CHANGELOG.md](./CHANGELOG.md) for unreleased integration notes.
