---
title: "Async Semantics"
description: "How @sx/runtime-context propagates through await and task boundaries."
---

# Async Semantics

`@sx/runtime-context` propagates through `await` when the async work is returned
from `.run`.

```ts
await ctx.provider(1).run(async () => {
  await something();
  return ctx.get(); // 1
});
```

Fire-and-forget work is detached:

```ts
let dangling: Promise<unknown>;

ctx.provider(1).run(() => {
  dangling = readLater();
});
```

Return the promise from `.run`, or use `capture` for task boundaries like timers
and event listeners.
