# Trace dashboard and recording server

The React dashboard, local recording server, CLI launcher, and Vite adapter for
[`@sx/tracing`](../tracing/README.md).

The packages are prepared for publication; use [local archives](../../docs/development.md#local-package-archives) until a release is available.

```sh
yarn add --dev @sx/dashboard
yarn trace-dashboard --port 4178
```

## Documentation

Tracing is documented as one pipeline, in the recorder package, because
recording and viewing are two halves of the same contract:

- [Dashboard and recording server](../tracing/DASHBOARD.md) —
  running the UI and server, public entry points, embedding, reading recording
  data without our UI.
- [Extending](../tracing/EXTENDING.md) — emitting custom data,
  then rendering it as blocks, columns, and pages.
- [Performance reports](../tracing/PERFORMANCE_REPORTS.md) —
  generated comparison reports.
- [Guidelines](../tracing/GUIDELINES.md) — ownership,
  compatibility, and release rules.
- [Recorder README](../tracing/README.md) — instrumenting code
  and starting recordings.

## Entry points

| Import                                             | Use                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `@sx/dashboard`           | React application, core dashboard, blocks, hooks, data APIs, HTML export |
| `@sx/dashboard/style.css` | Styles for imported React components                                     |
| `@sx/dashboard/data`      | Recording types, parser, HTTP client, analysis; no React runtime         |
| `@sx/dashboard/server`    | Node server and recording middleware; no React runtime                   |
| `@sx/dashboard/vite`      | Optional Vite recording-server plugin                                    |

ESM and CJS builds ship with declarations. React 18 and ReactDOM 18 are optional
peers needed for the imported UI components; Vite is an optional peer needed only
for the adapter. The CLI and server serve the pre-bundled default UI without
React installed separately. Browser entry points must not import the Node server
entry point. Node 22.14 or newer is required for the server.

## Consumer extensions

See [dashboard recipes](../../docs/examples/dashboard-recipes.md) for custom pages,
sortable columns, inspector metadata, composition, and offline export guidance.

The default UI works without extension configuration. Consumers can supply overview blocks, sortable function columns, page/block replacements, additional pages, and offline export projections through the public API. See [the extension contract](../tracing/EXTENDING.md). Custom pages are consumer-owned in every recording mode; conditionally omit pages whose data is unavailable.

## Embed the default UI

Install the React 18 and ReactDOM 18 peers in your React application, then:

```tsx
import { DashboardApp } from '@sx/dashboard';
import '@sx/dashboard/style.css';

export function App() {
  return <DashboardApp serverUrl="http://127.0.0.1:4178" />;
}
```

For a customized build, pass `extensions` and serve the consumer's output with
`trace-dashboard --dashboard ./dist --recordings ./local-traces`. The supplied
server handles dashboard routes. The CLI aliases are `dashboard` and
`trace-dashboard`; `trace-performance-report` generates offline reports.

Use [`startRecordingServer`](../tracing/DASHBOARD.md#run-the-server-programmatically)
for programmatic startup and the `/data` entry for non-React analysis. The default
server binds to loopback and has no shared-host authentication.

## Changes

See [CHANGELOG.md](./CHANGELOG.md) for unreleased integration notes.
