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

Trace a whole service, select individual methods, or wrap a function directly.
These examples use a checkout flow: calculate a price, apply a discount, and
explain the result with application data.

Open the application with `?install-tracing` **before its modules evaluate**.
Decorator examples require TypeScript's `"experimentalDecorators": true`
([configuration and API](/guide/tracing/#instrument-code)); these are legacy
TypeScript decorators, not the newer standard decorator API.

### Class decorators

Put `@Trace` on a service to capture its methods and their nested calls. Use
`@TraceIgnore` for a helper you do not need in the recording.

```ts
import { Trace, TraceIgnore } from '@sx/tracing';

@Trace
class Checkout {
  static namespace = 'checkout';

  total(prices: number[]) {
    const subtotal = this.subtotal(prices);
    return this.applyDiscount(subtotal);
  }

  subtotal(prices: number[]) {
    return prices.reduce((sum, price) => sum + price, 0);
  }

  applyDiscount(amount: number) {
    return this.round(amount * 0.9);
  }

  @TraceIgnore
  round(amount: number) {
    return Math.round(amount * 100) / 100;
  }
}

const checkout = new Checkout();
const runScenario = () => checkout.total([40, 60]); // 90
```

**Recorded:** `checkout.total` owns calls to `checkout.subtotal` and
`checkout.applyDiscount`. The rounding helper is omitted. Here `static namespace`
sets the method-name prefix; it is not the event's separate namespace field.

### Method decorators

Put `@Trace` on selected methods when you want a focused recording without
instrumenting every method in a class.

```ts
import { Trace, marker } from '@sx/tracing';

class Checkout {
  @Trace
  total(prices: number[]) {
    const subtotal = prices.reduce((sum, price) => sum + price, 0);
    return this.applyDiscount(subtotal);
  }

  @Trace
  applyDiscount(amount: number) {
    marker('discount-applied', { campaign: 'welcome', percent: 10 });
    return amount * 0.9;
  }

  formatReceipt(amount: number) {
    return `Total: ${amount.toFixed(2)}`;
  }
}

const checkout = new Checkout();
const runScenario = () => checkout.formatReceipt(checkout.total([40, 60]));
```

**Recorded:** `total` → `applyDiscount`, with a `discount-applied` marker.
`formatReceipt` runs normally but is not captured. Method-only decorators use the
method name; use a class decorator or a manual wrapper for a more specific name.

### Manual tracing

Wrap functions without decorators or a class. Give each operation an explicit
name and namespace so independently owned modules can share a recording.

```ts
import { trace, marker } from '@sx/tracing';

const applyDiscount = trace((amount: number) => {
  marker('discount-applied', { campaign: 'welcome', percent: 10 });
  return amount * 0.9;
}, 'applyDiscount', { namespace: 'pricing' });

const total = trace((prices: number[]) => {
  const subtotal = prices.reduce((sum, price) => sum + price, 0);
  return applyDiscount(subtotal);
}, 'total', { namespace: 'checkout' });

const runScenario = () => total([40, 60]); // 90
```

**Recorded:** a `total` call in `checkout` owns an `applyDiscount` call in `pricing`.
Both belong to one ray. No decorator compiler configuration is needed.

### Custom metadata

Attach domain context to a ray so a call tree also explains *why* the application
took that path. This example records whether a product price came from cache.

```ts
import { trace, marker, setTraceRayMetadata } from '@sx/tracing';

const priceCache = new Map([['sku-42', 100]]);

const quote = trace((sku: string) => {
  const cached = priceCache.get(sku);
  const hit = cached !== undefined;

  setTraceRayMetadata('catalog.cache', {
    version: 1,
    sku,
    outcome: hit ? 'hit' : 'miss',
  });
  marker('cache-lookup', { hit });

  // A cache miss is an explicit outcome, not a fabricated price.
  return cached === undefined ? null : { sku, price: cached * 0.9 };
}, 'quote', { namespace: 'catalog' });

const runScenario = () => quote('sku-42'); // { sku: 'sku-42', price: 90 }
```

**Recorded:** a `quote` ray with `catalog.cache` metadata and a `cache-lookup`
marker. Consumers can show these fields in their own dashboard columns or blocks.
For writes after `await`, use an explicit ray handle as shown in the
[metadata guide](/guide/ray-metadata/).

### Capture the selected scenario

Each example defines `runScenario`. Add this capture boundary to the chosen
example, or use [recording sessions](/guide/recordings/) to stream it to the dashboard.

```ts
import { startRecording, releaseRecording } from '@sx/tracing';

startRecording({ mode: 'full', cpu: false });
try {
  runScenario();
} finally {
  const recording = releaseRecording();
  console.log(recording.traces);
}
```

Wrappers remain installed between recordings; capture is opt-in. For async
scenarios, await the measured work before releasing the recording. The
[setup guide](/guide/getting-started/) covers local package archives and the intended
npm workflow; the integration has not yet been published as a release.

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
