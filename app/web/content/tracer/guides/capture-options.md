---
title: "Capture Options"
description: "Capture args, results, errors, timing, and stacks safely."
---

# Capture Options

By default, `trace(fn)` records the call shape, not every value. Capture options
are opt-in because values can be large, sensitive, or expensive to compute.

## Redact arguments

```ts
const charge = trace(
  async function charge(card: Card, amount: number) {
    return paymentGateway.charge(card, amount);
  },
  {
    captureArgs: ([card, amount]) => ({
      cardBrand: (card as Card).brand,
      amount,
    }),
  },
);
```

Do not capture raw tokens, passwords, cookies, or full request bodies.

## Capture errors deliberately

```ts
const save = trace(saveOrder, {
  captureError(error) {
    return error instanceof Error
      ? { name: error.name, message: error.message }
      : { message: String(error) };
  },
});
```

This keeps the trace useful without turning it into a secret dump.

## Timing and stacks

Use `captureTiming` when duration is part of the question. Use `captureStack`
when you need call-site evidence. Both add work, so keep them scoped to the
functions you are actively investigating.
