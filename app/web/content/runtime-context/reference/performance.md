---
title: "Performance"
description: "Performance guidance for @sx/runtime-context."
---

# Performance

Sync reads are the best path. They walk the current frame chain directly.

After `await`, `.get()` may need to parse a fresh stack to recover the active
async frame. For hot async functions, read once at the top and use a local value:

```ts
async function saveOrder() {
  const request = requestContext.get();

  await writeOrder(request?.requestId);
  await queue.publish(request?.requestId);
}
```

Run the local benchmark:

```bash
yarn bench:context
```
