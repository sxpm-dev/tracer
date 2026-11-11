# First recording

[Documentation index](./README.md)

The instrumented application runs in a browser. The dashboard server runs locally
on Node 22.14 or newer. Use the repository's `.node-version` when developing here.
Full and light instrumentation require `?install-tracing` before module evaluation.
Browser-signal-only capture is the exception; it does not instrument functions.

## 1. Prepare the packages

For published packages, install `@sx/recordings` in the application and
`@sx/dashboard` as a development dependency, then run `npx trace-dashboard`.
Publication is not implied by the package names in this repository.

For this checkout:

```sh
yarn install
yarn build
yarn start:dashboard --port 4178
```

To try the libraries in a separate local application before publication, follow
[local package archives](./development.md#local-package-archives). The dashboard
ships its default UI; a consumer does not build it to run the CLI.

## 2. Enable instrumentation

Load your application at, for example,
`http://localhost:3000/?install-tracing`. Add `&install-tracing` if the URL already
has query parameters. Reload after adding the flag: it is read and cached while
modules initialize. Adding it after decorators or wrappers are created does not
retroactively instrument those definitions.

## 3. Record an operation

This example has no application-specific dependencies:

```ts
import { marker, recordSession, releaseSession, trace } from '@sx/recordings';

const load = trace(async (id: string) => {
  marker('cache-hit', { key: id });
  await Promise.resolve();
  return { id, name: 'Example' };
}, 'load', { namespace: 'catalog' });

await recordSession('Load a product', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'full',
  withArguments: false,
});
try {
  console.log(await load('product-1'));
} finally {
  const recording = await releaseSession();
  console.log(recording.sessionId);
}
```

Wait for `recordSession` before the measured work. Await `releaseSession` before
leaving the page; it flushes remaining data and finalizes the saved session.
The example lets a release failure propagate; production callers should handle
application and upload errors separately if they must preserve both failures.

## 4. Inspect the result

Open `http://127.0.0.1:4178` and refresh sessions. Inspect Overview, Functions,
and Trace frames. Default files go into `.recordings` relative to the server's
working directory. Use `--recordings ./local-traces` to choose another location.

Timing is elapsed time, including awaited work. It is not exclusive CPU time.
Return values remain application return values; the runtime does not automatically
capture them. Use a small JSON-safe marker or extension sample for result metadata.

## In-memory capture without a server

Import only `@sx/tracing` when no transport is needed:

```ts
import { startRecording, releaseRecording, trace } from '@sx/tracing';

const sum = trace((a: number, b: number) => a + b, 'sum', { namespace: 'math' });
startRecording({ mode: 'full', cpu: false });
try {
  sum(2, 3);
} finally {
  const recording = releaseRecording();
  console.log(JSON.stringify(recording));
}
```

Save the JSON and import it in the dashboard. One recording can be active per
JavaScript realm. Workers and iframes have separate globals; they are not one
automatically merged recording.

## Next steps

- [Capture modes and method filters](../packages/tracing/README.md#recording-options).
- [Record cache statistics and add custom UI](../packages/tracing/EXTENDING.md).
- [Embed the dashboard](../packages/tracing/DASHBOARD.md).
- [Troubleshoot an empty recording](./troubleshooting.md).
