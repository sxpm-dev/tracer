---
title: "@sx/tracer"
description: "Scope-based tracing for JavaScript call trees and markers."
---

# `@sx/tracer`

Tiny scope-based tracer for browser and Node. It records call trees, inline
markers, named async steps, timing, and subscribed events only inside an active
trace scope.

## Why this package exists

Sometimes you do not need a production distributed tracing system. You need to
answer a local question: which functions ran, in which order, where did the
workflow branch, and what markers were emitted after an `await`?

Console logs answer part of that, but they flatten structure and are hard to
turn on for one sampled operation. OpenTelemetry answers a larger production
problem, but it brings span conventions, exporters, propagation, and deployment
decisions.

`@sx/tracer` exists for the smaller job: wrap functions, open a scope, collect a
call tree, and optionally forward events.

## The issue it solves

Without a scoped tracer, debug output tends to become global:

```ts
async function checkout(cart: Cart) {
  console.time("checkout");
  console.log("validate");
  await validate(cart);
  console.log("charge");
  await charge(cart);
  console.timeEnd("checkout");
}
```

That is useful once, then it becomes noise.

With `@sx/tracer`, recording is explicit:

```ts
import { marker, trace } from "@sx/tracer";

const checkout = trace(async function checkout(cart: Cart) {
  await trace.step("validate", async () => {
    await validate(cart);
    marker("ok", { items: cart.items.length });
  });

  await trace.step("charge", async () => {
    await charge(cart);
    marker("authorized");
  });
});

const report = await trace.collect(() => checkout(cart));
console.log(report.names);
```

Outside `trace.collect`, `checkout` is still just a function call.

## What it is for

- development call-tree inspection
- lightweight workflow traces
- inline phase markers
- sampled event forwarding
- teaching or explaining execution flow

## Real examples

| Example | Why it matters |
| --- | --- |
| [Trace Collection](/tracer/examples/trace-collection) | Inspect nested async work with markers. |
| [Telemetry Forwarder](/tracer/examples/telemetry-forwarder) | Subscribe to recorded events and ship them elsewhere. |
| [Tracing Work](/tracer/guides) | Model named async phases with `trace.step`. |

## Start here

```ts
import { marker, trace } from "@sx/tracer";

const loadUser = trace(async function loadUser(id: string) {
  marker("query-start", { id });
  await Promise.resolve();
  marker("query-end");
});

const report = await trace.collect(() => loadUser("u1"));
console.log(report.names);
```

Read [Getting Started](/tracer/getting-started) for the first full example, then
use the [API reference](/tracer/api) for exact signatures.

## When not to use it

- Use OpenTelemetry for distributed traces, cross-service propagation, exporters,
  and production observability standards.
- Use regular logging for permanent business events.
- Avoid capturing arguments/results by default if values may contain secrets.
