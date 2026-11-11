# Performance and test evidence

[Documentation index](./README.md)

## What is currently measured

The checked-in benchmark scripts belong to the original `@sx/tracer` and
`@sx/runtime-context` libraries:

```sh
yarn bench
yarn bench:tracer
yarn bench:context
```

They build those packages and run their microbenchmarks. Numbers in their READMEs
are historical observations, not fresh results for `@sx/tracing`, `@sx/recordings`,
or the dashboard. The integrated runtime has different capture and transport
behavior. Do not copy legacy timings into claims about the integrated packages.

The integration and extension validation recorded 195 passing tests, plus package
builds, typechecks, and npm consumer checks. Those are correctness results, not a
throughput or browser support certification. Rerun the commands in the
[development guide](./development.md) to obtain current evidence.

## Measure the complete path

For a publishable benchmark, keep workload, data, environment, and repetitions
consistent and save raw output alongside the summary. Record Node/browser versions,
hardware, build/minification settings, sample size, warm-up, and variability.

Compare at least:

| Scenario | What it isolates |
| --- | --- |
| Uninstrumented application | Baseline |
| Flag absent | Instrumentation installation bypass |
| Flag present, recording inactive | Installed wrapper cost |
| Full capture, synchronous work | Call/event allocation and retention |
| Full capture across awaits | Async stack lookup cost |
| Full capture with async context disabled | Timing without cross-await linking |
| Light capture | Aggregation and retained-window budgets |
| Browser-only capture | Signal observers without function tracing |
| Optional arguments/errors/metadata | Serialization and payload cost |
| Streaming session | Batching, server latency, and retained client data |
| Large saved session | Index preparation, query latency, browser memory, disk |
| Multiple custom collectors | Consumer overhead and payload growth |

Batch size controls request grouping; it is not a hard cap on retained recording
memory. Large individual custom samples may exceed a target batch size. Full
recordings and deduplication state remain live until release. Light mode has
window/function limits, but custom extension samples still require consumer bounds.

## Interpret the dashboard correctly

- Call durations are elapsed time. Async and nested durations overlap.
- Heap observations cover the process/page heap, not allocations owned by a method.
- Browser blocking is not CPU utilization. Unsupported signals are unavailable,
  not zero.
- Synthetic sample recordings demonstrate UI behavior; they do not benchmark the
  user's machine or validate a speed claim.
- Generated [performance reports](../packages/tracing/PERFORMANCE_REPORTS.md)
  compare captured application sessions. They do not measure the recorder's own
  overhead automatically.

## Remaining publication evidence

A supported-engine matrix and reproducible integrated-package benchmark results
still need to be collected for the intended release targets. This Markdown pass
does not create or claim those results. Keep regression tests and representative
benchmarks separate: tests should establish behavior; benchmarks should quantify
cost under documented conditions.
