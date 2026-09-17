---
title: "Checkout Flow"
description: "Trace a multi-step checkout workflow."
---

# Checkout Flow

This example uses `trace.step` for phases that deserve names but do not need
separate exported functions.

```ts
import { marker, trace } from "@sx/tracer";

const checkout = trace(async function checkout(cart: Cart) {
  marker("start", { items: cart.items.length });

  await trace.step("validate", async () => {
    await validateInventory(cart);
    marker("inventory-ok");
  });

  await trace.step("price", async () => {
    const total = await priceCart(cart);
    marker("priced", { total });
  });

  await trace.step("charge", async () => {
    const authorization = await chargePayment(cart);
    marker("authorized", { authorizationId: authorization.id });
  });
});

const report = await trace.collect(() => checkout(cart));

console.log(report.names);
```

Typical output:

```ts
[
  "checkout",
  "checkout.start",
  "validate.inventory-ok",
  "price.priced",
  "charge.authorized",
]
```

The trace gives you structure without forcing every phase into its own function.
