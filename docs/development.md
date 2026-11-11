# Development and release preparation

[Documentation index](./README.md)

## Setup and verification

Use the Node version in [`.node-version`](../.node-version) and the Yarn version in
[root package.json](../package.json). The imported reference is not a second
workspace to install. Run commands from this repository root:

```sh
yarn install
yarn build
yarn typecheck
yarn test
yarn test:packages
```

Build first: dependent packages resolve public declarations from `dist`.
`yarn build` builds all five libraries and the dashboard's standalone assets;
it does not build the separate documentation website.

| Check | Coverage |
| --- | --- |
| `yarn test` | Original libraries, tracing collectors and capture, transport, dashboard UI/data/server |
| `yarn typecheck` | Package source types; this does not run the application |
| `yarn build` | ESM/CJS bundles, declarations, dashboard CLIs, and standalone UI |
| `yarn test:packages` | Packs three integrated packages, installs in a temporary consumer, checks ESM/CJS types, CLI/assets, shared state, and custom data upload/readback |

The artifact check uses npm locally and may resolve dependencies from the registry.
It does not publish anything. UI tests use jsdom; they are not a real-browser
compatibility matrix. See [performance and testing](./performance.md).

Focused commands:

```sh
yarn workspace @sx/tracing test
yarn workspace @sx/recordings test
yarn workspace @sx/dashboard test tests/extensions.spec.tsx
yarn workspace @sx/dashboard build
yarn start:dashboard --port 4178 --recordings ./local-traces
```

The integrated test runner limits worker concurrency to two. Preserve the supplied
behavioral tests when refactoring package boundaries; add regression coverage for
changes to storage, custom channels, and consumer UI contracts.

## Local package archives

Build before packing. Run these from the repository root:

```sh
mkdir -p tmp/packages
npm pack ./packages/tracing ./packages/recordings ./packages/dashboard \
  --pack-destination ./tmp/packages
```

In a separate application, install all three archives together so local package
versions satisfy their dependencies. Replace `/path/to/tracer` with this checkout:

```sh
npm install /path/to/tracer/tmp/packages/sx-tracing-1.0.0.tgz \
  /path/to/tracer/tmp/packages/sx-recordings-1.0.0.tgz \
  /path/to/tracer/tmp/packages/sx-dashboard-1.0.0.tgz
npx trace-dashboard --port 4178
```

Archive filenames include package versions; use the names printed by `npm pack`
if versions change. The public manifests are the authority for current exports,
engines, peers, and included files.

## Before a release

1. Run the verification sequence above from a clean dependency installation.
2. Inspect npm archives: declarations for both module formats, CLI executable
   entries, UI assets, docs, and third-party notices must be present.
3. Verify compatibility in the target browsers and production bundler; unit tests
   alone do not establish async stack-recovery support.
4. Review capture privacy, representative runtime overhead, transport behavior,
   and large-recording memory/disk usage. Record environment and raw results.
5. Update package versions and changelogs together when the shared contract changes.
6. Confirm the registry names and publication process before publishing. Local
   builds and successful archive tests do not mean a package has been published.

No root `yarn validate` command or internal-registry release workflow is configured
here. Use the actual scripts above. Website work is deferred; its existing commands
are described in [app/web](../app/web/README.md).

## Optional LLM benchmark utility

The root `bench:llm-token:fixture` and `bench:llm-token` scripts compare a JSON
fixture with a PNG-token representation in model prompts. They are separate from
tracing performance. The latter calls paid APIs and requires provider credentials;
see the scripts' command-line options before running it. Generated fixtures and
results live under the ignored `tmp` directory.
