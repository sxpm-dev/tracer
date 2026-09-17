---
title: "Guide: Runtime Context"
description: "How to model request and workflow state with runtime-context."
---

# Guide: Runtime Context

Use runtime context for values that are stable for a logical operation:

- request id
- current user id
- locale
- feature flag snapshot
- trace or correlation id
- tenant id

## Model one boundary

Create a context once, then provide it at the edge of the operation.

```ts
import { createContext } from "@sx/runtime-context";

export const requestContext = createContext<{
  requestId: string;
  userId?: string;
  locale: string;
}>();

export function handleRequest(request: Request) {
  return requestContext.provider(readRequestState(request)).run(async () => {
    return routeRequest(request);
  });
}
```

Inside helpers, read the value:

```ts
export function audit(action: string) {
  const request = requestContext.get();
  console.info("audit", action, request?.requestId);
}
```

## Prefer capture-local async code

For hot async functions, read once before the first expensive awaited section.

```ts
async function saveOrder() {
  const request = requestContext.get();

  await writeOrder(request?.userId);
  await publishOrderEvent(request?.requestId);
}
```

This is faster than repeatedly calling `.get()` after every `await`.

## Capture scheduled callbacks

Timer and event callbacks are separate tasks. Wrap them with `capture` when they
need the current context.

```ts
import { capture } from "@sx/runtime-context";

requestContext.provider({ requestId: "r1", locale: "en" }).run(() => {
  queueMicrotask(capture(() => audit("queued")));
  setTimeout(capture(() => audit("later")), 0);
});
```

## Avoid service locator drift

Context is best for ambient operation metadata. Keep dependencies, clients, and
mutable business state explicit unless they truly belong to the operation
boundary.
