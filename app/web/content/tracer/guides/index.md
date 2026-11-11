---
title: "Guide: Tracing Work"
description: "How to collect call trees, markers, and telemetry events."
---

# Guide: Tracing Work

Tracing is opt-in at the scope boundary. Wrap the functions you might want to
observe, then decide when to collect.

## Wrap meaningful functions

```ts
import { marker, trace } from "@sx/tracer";

export const priceCart = trace(function priceCart(cart: Cart) {
  marker("items", { count: cart.items.length });
  return cart.items.reduce((sum, item) => sum + item.price, 0);
});
```

Outside `trace.collect`, this is a direct function call with minimal overhead.

## Collect a sample

```ts
const report = trace.collect(() => priceCart(cart));

console.table(report.names);
```

Use `names` for quick inspection and `events` when you need parent ids, status,
timing, arguments, result values, or marker payloads.

## Add async phases

```ts
const checkout = trace(async function checkout(cart: Cart) {
  await trace.step("validate", async () => {
    await validateCart(cart);
    marker("ok");
  });

  await trace.step("charge", async () => {
    await chargeCard(cart);
    marker("authorized");
  });
});
```

`trace.step` is useful when the phase is real but extracting another function
would only add noise.

## Forward events

```ts
const unsubscribe = trace.subscribe((event) => {
  telemetry.record({
    ray: event.ray,
    name: event.name,
    kind: event.kind,
    at: event.at,
    data: event.data,
  });
});
```

Subscribers receive recorded events from all active trace scopes. Unsubscribe
when the forwarding lifecycle ends.
