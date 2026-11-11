---
title: "Stack-based tracing"
description: "Record JavaScript execution using stack-based context recovery, then inspect calls, timings, and application data."
---

# Stack-based tracing

Record how a JavaScript operation executes: which functions it calls, how they
relate, how long they take, and what application-specific data they produce.

`@sx/tracing` recovers async call ownership from `Error.stack`.
`@sx/recordings` saves and batches the captured data.
`@sx/dashboard` provides an installable viewer that consumers can extend.

[Create a recording](/guide/getting-started/) · [Read the tracing API](/guide/tracing/) · [View benchmark results](/guide/context-benchmarks/)

## How stack recovery works

Synchronous calls use an in-memory stack of active frames. Across an `await`, the
runtime can recover the owning call by finding a named wrapper in
`new Error().stack` and looking up its recording slot.

```text
Wrapped call       Associate the operation with a recording slot
      │
    await          Keep the named async wrapper alive
      │
Resumed work       Read Error.stack → find wrapper → recover parent
```

Creating an error and reading its stack **does not throw it**. Application errors
are captured separately and rethrown to preserve normal behavior.

This avoids patching `Promise` or requiring Node's `AsyncLocalStorage`. It also
depends on the engine's stack format and supported async chains. Detached callbacks
can lose ownership, and stack inspection adds cost.
[Mechanism, examples, and limits](/guide/how-tracing-works/).

## Record an operation

Load the application with `?install-tracing` before its modules evaluate. Wrap the
functions you want to inspect, then start and release a recording around a scenario.

```ts
import {
  trace, marker, startRecording, releaseRecording,
} from '@sx/tracing';

const total = trace((prices: number[]) => {
  marker('cart-size', { items: prices.length });
  return prices.reduce((sum, price) => sum + price, 0);
}, 'total', { namespace: 'checkout' });

startRecording({ mode: 'full', cpu: false });
try {
  total([12, 8, 5]);
} finally {
  const recording = releaseRecording();
  console.log(recording.traces);
}
```

Use [recording sessions](/guide/recordings/) to send batched updates to the
dashboard. The [setup guide](/guide/getting-started/) covers local package archives
and the intended npm installation workflow; the integration has not yet been
published as a release.

## Compare executions, not just outcomes

An E2E test can pass while the application does extra work. A warm-cache checkout
might display the correct confirmation after making two unexpected product fetches.

| Check | Baseline | Candidate |
| --- | --- | --- |
| Confirmation visible | Pass | Pass |
| Product fetches | 0 | 2 |
| Execution path | Cache hit | Network fallback and duplicate fetch |

This is an illustrative comparison. A consumer can normalize recorded call trees,
exclude timing noise, and compare them against reviewed baselines. Unexpected paths,
call counts, or error outcomes become signals to investigate.
[Execution comparisons and anomaly detection](/guide/execution-anomalies/) explains
how to build that policy; an automatic detector is not included.

## Use recordings with AI

Give AI the recording, the scenario, and the matching source revision. Ask it to
identify repeated work, map observations to functions, and propose a targeted
change. Record the same scenario again to check the result.

```text
Instrument → Record → Analyze with source → Change code → Record again
                └──────────────── Compare ───────────────────┘
```

A recording preserves the execution you captured. An AI-run application can
explore new inputs, but may not reproduce that environment or state. Both can help;
neither replaces correctness tests. The [runtime analysis guide](/guide/ai-runtime-workflow/)
includes prompts, source-mapping steps, and comparison criteria.

## Add application data and views

- **Ray metadata** describes one operation: request context, cache outcomes, or
  subsystem results. [Per-ray examples](/guide/ray-metadata/).
- **Markers and collectors** capture events within calls and recording-wide
  samples. [Collector examples](/guide/tracing-data/).
- **Dashboard extensions** add columns, blocks, and pages for that data.
  [UI recipes](/guide/dashboard-recipes/) and [a cache example](/guide/cache-extension/).

The default dashboard can be installed and run as an npm package. The same data
APIs and React components are available for a consumer's own viewer.

Compatible copies in one JavaScript realm share tracing state through `globalThis`.
A frontend shell owns capture; microfrontends contribute namespaced events.
Iframes, workers, and backend services need explicit correlation.
[Shared-runtime integration](/guide/shared-runtime/).

## Choose the right scope

| Package | Responsibility |
| --- | --- |
| [@sx/tracing](/guide/tracing/) | Instrumentation, context recovery, and in-memory capture |
| [@sx/recordings](/guide/recordings/) | Sessions and batched transport; re-exports tracing APIs |
| [@sx/dashboard](/guide/dashboard/) | Default viewer, CLI, local server, data APIs, and extensions |
| [@sx/runtime-context](/runtime-context/) | Independent ambient context library |
| [@sx/tracer](/tracer/) | Original scope-based tracer with a different API |

This is in-process instrumentation, with explicit capture boundaries. It does not
automatically propagate context over the network or observe uninstrumented code.

For performance decisions, read the [AsyncLocalStorage comparison](/guide/async-local-storage/),
[measured benchmark tables](/guide/context-benchmarks/), and
[capture overhead guidance](/guide/performance/). Context-access microbenchmarks
are not measurements of end-to-end recording overhead.
