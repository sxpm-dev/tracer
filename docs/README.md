# Documentation

[Repository home](../README.md)

Read these guides directly on GitHub. The website migration is a separate phase.

## Learn and use

1. [First recording](./getting-started.md): install, enable instrumentation, capture, and inspect.
2. [How tracing works](./how-tracing-works.md): `Error().stack`, async ownership, thrown errors, and limits.
3. [Tracing reference](../packages/tracing/README.md): functions, decorators, filters, and modes.
4. [Recording sessions](../packages/recordings/README.md): lifecycle, batching, failure behavior, and low-level APIs.
5. [Dashboard guide](../packages/tracing/DASHBOARD.md): CLI, embedding, server, data entry points, navigation, and exports.
6. [Consumer extensions](../packages/tracing/EXTENDING.md): custom data, collectors, blocks, columns, pages, and projections.
7. [Performance reports](../packages/tracing/PERFORMANCE_REPORTS.md): comparisons, formulas, CLI, and example configuration.
8. [Offline analytics](../packages/tracing/tools/recording-query/README.md): Python queries over saved JSONL recordings.

## Consumer examples

[Extra data per tracing ray](./examples/ray-metadata.md) shows independent request context, cache outcomes, nested consumers, async handles, and dashboard reads.

[Browse all examples](./examples/README.md).

### Recording-wide data and UI

[Cache telemetry and custom dashboard](./examples/cache-extension.md) includes a bounded collector, payload validation, summary-aware paged loading, cancellation, and a default-UI extension.

## Understand and maintain

- [Architecture](./architecture.md): package boundaries, lifecycle, and extension ownership.
- [Migration](./migration.md): original tracer versus the integrated packages.
- [Error-stack context versus AsyncLocalStorage](./async-local-storage.md): mechanisms, measured results, safety and propagation gaps.
- [Measured Node 22/24 benchmark report](./benchmarks/context-2026-11-11.md): reproducible commands, complete output and limitations.
- [Performance and test evidence](./performance.md): how to measure and what is not yet established.
- [Troubleshooting](./troubleshooting.md): activation, transport, missing data, and UI issues.
- [Development and release](./development.md): commands, artifact checks, and release preparation.
- [Maintainer guidelines](../packages/tracing/GUIDELINES.md): invariants and compatibility.
- [Integration record](./workspace-integration.md) and [extension review](./consumer-extensions.md): dated implementation evidence, not substitutes for running current tests.

## Independent original libraries

- [`@sx/tracer`](../packages/tracer/README.md): scope-based capture and its own API.
- [`@sx/runtime-context`](../packages/runtime-context/README.md): ambient values with explicit callback capture.

The imported reference contains historical project context. Prefer the guides above
for current commands and package boundaries; follow the reference when investigating
where production behavior originated.
