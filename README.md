# @sx — tracing, recordings, and dashboards

Record instrumented JavaScript calls, stream sessions to a local dashboard, and
extend both the captured data and the UI for your application. The default
dashboard runs as an npm-installed application; consumers can also embed its React
components or serve their own dashboard build.

**Start here: [Documentation](./docs/README.md) · [First recording](./docs/getting-started.md) · [How stack recovery works](./docs/how-tracing-works.md) · [Consumer extensions](./packages/tracing/EXTENDING.md)**

## Packages

| Package | Purpose | Guide |
| --- | --- | --- |
| `@sx/tracing` | Instrumentation, markers, errors, browser signals, in-memory recording | [API and capture modes](./packages/tracing/README.md) |
| `@sx/recordings` | Recording sessions and batched transport; re-exports tracing APIs | [Sessions and transport](./packages/recordings/README.md) |
| `@sx/dashboard` | Default UI, local server, CLI, data APIs, and consumer UI extensions | [Dashboard README](./packages/dashboard/README.md) |
| `@sx/tracer` | Original standalone scope-based tracer with `trace.collect` | [Original tracer](./packages/tracer/README.md) |
| `@sx/runtime-context` | Independent ambient context library | [Runtime context](./packages/runtime-context/README.md) |

`@sx/tracer` and `@sx/tracing` have different APIs. See the
[migration guide](./docs/migration.md) before switching imports.

## Quick start

These are the intended package names and install commands. This repository's
integration work has not published them; use the source workflow below or local
package archives until a release is available.

```sh
npm install @sx/recordings
npm install --save-dev @sx/dashboard
npx trace-dashboard --port 4178
```

Open your application with `?install-tracing` **before its modules load**. Then,
in application code:

```ts
import { marker, recordSession, releaseSession, trace } from '@sx/recordings';

const calculate = trace((value: number) => {
  marker('input', { value });
  return value * 2;
}, 'calculate', { namespace: 'example' });

await recordSession('First recording', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'full',
});
try {
  calculate(21);
} finally {
  await releaseSession();
}
```

Open the dashboard at `http://127.0.0.1:4178` and refresh the sessions list.
The [complete walkthrough](./docs/getting-started.md) covers local installation,
in-memory capture, errors, and loading recordings.

## Core idea

Across an `await`, tracing can recover the active call by inspecting
`new Error().stack` for a named async wrapper and looking up its recording slot.
**It does not throw an error to perform this lookup.** Application errors are
captured separately and rethrown to preserve application behavior. This avoids
patching `Promise` or depending on Node's `AsyncLocalStorage`, but depends on the
engine's stack behavior and adds cost. [Mechanism and limits](./docs/how-tracing-works.md).

## Consumer-owned extensions

Collectors emit namespaced samples such as cache hits or queue depth. Ray metadata
adds context to an operation. Unknown channels survive transport and storage
without adding application-specific fields to the server. Consumers render them
through dashboard blocks, columns, pages, or their own data-only UI.

The basic dashboard works with no extension configuration. See
[the extension guide](./packages/tracing/EXTENDING.md) for both halves of the pipeline.

## Work on the repository

Use the Node version in [`.node-version`](./.node-version) and Yarn 1.

```sh
yarn install
yarn build          # all library packages, including the bundled dashboard UI
yarn typecheck      # build dependencies first on a fresh checkout
yarn test           # all five package suites
yarn test:packages  # isolated npm installation and consumer checks; requires build
yarn start:dashboard --port 4178
```

The [development guide](./docs/development.md) covers focused commands, package
archives, tests, and release checks. [Performance](./docs/performance.md) distinguishes
legacy microbenchmarks from recording overhead and dashboard performance reports.

## Repository map

- [`packages/`](./packages): the five libraries and their Markdown guides.
- [`docs/`](./docs/README.md): onboarding, architecture, migration, troubleshooting, and contributor guides.
- [`app/web/`](./app/web/README.md): existing site for the original libraries; expansion is a later phase.
- [`scripts/`](./scripts): package consumer checks and optional benchmark utilities.

Markdown documentation is the current reader entry point. The website has not yet
been updated to cover the integrated packages. Package metadata declares MIT;
third-party dashboard font and icon notices are retained with that package.
