# @sx — tracing, recordings, and dashboards

Record instrumented JavaScript calls, stream sessions to a local dashboard, and
extend both the captured data and the UI for your application. The default
dashboard runs as an npm-installed application; consumers can also embed its React
components or serve their own dashboard build.

**Start here: [Documentation](./docs/README.md) · [First recording](./docs/getting-started.md) · [How stack recovery works](./docs/how-tracing-works.md) · [Consumer extensions](./packages/tracing/EXTENDING.md)**

## Understand runtime behavior with AI, then verify the improvement

Give an AI your code **and evidence of what that code did during a real scenario**.
Use the recording to ask concrete questions, connect the answers to source, and
measure whether an optimization actually helped.

```text
Add tracing to meaningful operations
                ↓
Record a real interaction or workload
                ↓
Give AI the recording data + matching source revision + scenario
                ↓
Ask how the code behaved at runtime
                ↓
AI connects observed calls, timings and custom data to source locations
                ↓
Ask for a targeted optimization and correctness tests
                ↓
Record the same scenario again → compare baseline and candidate
                ↺
```

1. **Add tracing.** Use stable names and namespaces. Add ray metadata, cache-hit
   markers, or consumer samples to explain application-specific behavior.
2. **Run a recording.** Reproduce the interaction you care about and save a baseline.
3. **Feed the evidence to AI.** Provide JSON/JSONL or report evidence, the matching
   source commit, and the scenario. Large recordings can be queried incrementally.
4. **Ask runtime questions.** “Why was this function called 200 times?”, “Which
   path repeated the database lookup?”, or “Did cache misses cluster in this ray?”
5. **Match observations to code.** Ask for a trace-to-source map with files/functions,
   evidence, and any ambiguous or uninstrumented paths identified explicitly.
6. **Optimize and test.** Ask for a change addressing the measured behavior, with
   tests preserving correctness.
7. **Record again and compare.** Use the same workload and capture settings. Check
   the expected improvement, errors, and regressions; repeat before claiming a win.

### Why not just ask AI to run the application?

Both approaches are useful and can be combined. An AI that runs the app must first
reproduce the right state, inputs, interactions, and environment. A recording lets
it inspect an execution you already captured, including consumer-specific context.

| Approach | Strength | Limitation |
| --- | --- | --- |
| Give AI a recording and matching source | Repeatable evidence from the chosen run; exposes recorded call counts, relationships, timings, and domain data | Only instrumented/captured behavior is visible; overhead and missing context can mislead |
| Ask AI to run the app itself | It can explore, change inputs, reproduce failures, and test new hypotheses | Setup and reproduction may be difficult; a different environment may exercise a different path |
| Combine them | Start from observed evidence, then use controlled runs to test the explanation | Still requires representative scenarios, correctness tests, and comparable measurements |

**Source matching is an analysis task, not an automatic completeness guarantee.**
The library does not upload to an AI, bundle the repository, or automatically
resolve every event to a source line. Stable instrumentation names and the exact
source revision help the AI build that mapping. Missing instrumentation and
ambiguous names must remain visible gaps, not invented explanations.

See the [AI-assisted optimization workflow](./docs/ai-runtime-workflow.md) for
handoff artifacts, prompt examples, source mapping, and before/after comparisons.

## Catch execution changes even when E2E stays green

A test can reach the expected screen while taking a different path: duplicate
fetches, extra retries, or a cache fallback. Record the scenario and compare its
**normalized call structure** with a reviewed baseline, independently of timing
variation. This can reveal execution anomalies early in CI.

The same evidence supports consumer-owned anomaly detection across repeated runs:
unexpected paths, changed call counts, errors, and custom cache signals. Tracing
provides the data; structural comparison rules, baseline management, and automated
alerts are implemented by the consumer. Matching traces supplement correctness
tests and only cover captured behavior.

See [E2E execution comparison and anomaly detection](./docs/execution-anomalies.md)
for examples, normalization rules, baseline policies, and dashboard integration.

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

For measured context-access costs and the limits of each approach, read the
[ALS comparison](./docs/async-local-storage.md) and [Node 22/24 benchmark report](./docs/benchmarks/context-2026-11-11.md).

## Consumer-owned extensions

Collectors emit namespaced samples such as cache hits or queue depth. Ray metadata
adds context to an operation. Unknown channels survive transport and storage
without adding application-specific fields to the server. Consumers render them
through dashboard blocks, columns, pages, or their own data-only UI.

The basic dashboard works with no extension configuration. See
[the extension guide](./packages/tracing/EXTENDING.md) for both halves of the pipeline.

## One tracing layer across frontend subsystems

**TL;DR:** the shell, microfrontends, shared libraries, and service adapters can
contribute calls and custom data to one recording through compatible shared
runtime/transport owners on `globalThis`.

- The shell starts and releases the session; subsystems instrument functions and
  register collectors with their own namespaces.
- Compatible duplicate package imports in the **same JavaScript realm** share
  capture state. The `__EDITOR_TRACING__` facade also supports legacy integrations.
- Separate iframes, workers, tabs, and backend services do **not** automatically
  share the recording. They need explicit correlation or a separate integration.

Read [shared runtime and microfrontend integration](./docs/shared-runtime.md) for
bootstrap order, a multi-subsystem example, the global API, version compatibility,
and cross-boundary limitations. See [per-ray data](./docs/examples/ray-metadata.md)
for attaching each subsystem's context to a shared operation.

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
- [`app/web/`](./app/web/README.md): static technical presentation and documentation site.
- [`scripts/`](./scripts): package consumer checks and optional benchmark utilities.

The website is generated from the Markdown guides, with an authored technical
overview. Run `yarn build:web` for a static export; see the
[website guide](./app/web/README.md) for GitHub Pages deployment. Package metadata declares MIT;
third-party dashboard font and icon notices are retained with that package.
