---
title: "Capture-Local Pattern"
description: "Use @sx/runtime-context efficiently in async functions."
---

# Capture-Local Pattern

`context.get()` is cheapest while the provider's synchronous frame is active.
After an `await`, the package may recover the frame by reading the async stack.
That recovery is useful, but it should not become a hot-loop habit.

## The slow shape

```ts
async function publishInvoice(invoiceId: string) {
  await loadInvoice(invoiceId);
  audit("invoice-loaded", requestContext.get()?.requestId);

  await sendInvoice(invoiceId);
  audit("invoice-sent", requestContext.get()?.requestId);

  await markComplete(invoiceId);
  audit("invoice-complete", requestContext.get()?.requestId);
}
```

This is correct, but every post-await read may pay recovery cost.

## The preferred shape

```ts
async function publishInvoice(invoiceId: string) {
  const request = requestContext.get();

  await loadInvoice(invoiceId);
  audit("invoice-loaded", request?.requestId);

  await sendInvoice(invoiceId);
  audit("invoice-sent", request?.requestId);

  await markComplete(invoiceId);
  audit("invoice-complete", request?.requestId);
}
```

Read once, then use the local value. This is easier to reason about and avoids
repeated stack recovery.

## When repeated reads are fine

Repeated reads are fine in low-volume code, synchronous helpers, and places
where clarity matters more than micro-cost. Reach for capture-local when the
function is hot, loops over many items, or sits in a high-volume request path.
