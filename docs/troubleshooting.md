# Troubleshooting

[Documentation index](./README.md)

| Symptom | Check and action |
| --- | --- |
| Starting capture says tracing is not installed | Add `install-tracing` to the application URL and reload before importing/defining wrappers. Full/light mode require the flag. |
| Functions never appear | Call the wrapped reference, await measured work, and check exact `methods` root filters. Browser mode does not capture functions. |
| A second recording cannot start | Release the current recording. Only one is active per realm. |
| First session upload fails | Start the server, confirm `serverUrl`, scheme and port, and check browser network errors. Session startup rolls back on failure. |
| Final upload rejects | Inspect the rejection and server logs. There is no durable offline spool or guaranteed retry. Avoid navigation until release settles. |
| HTTPS application cannot reach local HTTP server | Check browser mixed-content/local-network restrictions. Use a reachable endpoint compatible with the application's browser policy. |
| Custom overview shows no samples | Saved sessions initially load summaries. Query the channel with `sessionClient.samples`; complete local imports can read the raw array. |
| Decorated custom field disappears after upload | Top-level fields are local projections. Persist values as namespaced extension samples or ray metadata. |
| Custom page lacks data in browser mode | Consumer pages remain available, but browser-only capture does not record custom extension samples. Omit unsupported pages in the consumer. |
| Metadata update returns false | It needs an active full-mode ray; use a captured handle after awaits and do not reuse it across recordings. |
| Async parent/marker attribution differs | Check actual engine stack behavior, returned/awaited promise chains, production transforms, and `captureAsyncContext`. |
| CPU/memory chart is unavailable | The browser may not support the signal or grant access. An unavailable capture is not a zero measurement. |
| CLI cannot find UI assets | Build the dashboard before running from source; packed installations should include `dist/dashboard`. |
| Custom hosted route returns 404 | Serve the consumer's built dashboard directory with the shared server, which handles application routes. |
| Cannot import React components | Install the package's React 18/ReactDOM 18 peers and matching types. CLI/data/server usage does not need React peers. |
| Fresh checkout typecheck cannot resolve package declarations | Run `yarn build` first; dependencies expose built declarations. |

## Inspect a saved recording without the UI

```ts
import { createRecordingClient } from '@sx/dashboard/data';

const client = createRecordingClient('http://127.0.0.1:4178');
const recording = await client.load('replace-with-session-id');
console.log(recording.mode, recording.traces.length);
```

This loads complete data. Prefer summary and paged APIs for large sessions. Use
[offline analytics](../packages/tracing/tools/recording-query/README.md) when working
on local JSONL files without loading them all into browser memory.

## Report an issue

Include the package versions, runtime/browser, capture mode and options, whether
the installation flag was present before import, and a small reproducer. For data
issues, include a minimal recording with sensitive payloads removed. Distinguish
application exceptions, upload failures, unavailable browser signals, and UI query
errors so the failing boundary can be reproduced independently.
