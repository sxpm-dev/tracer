---
title: "Example: Request Context"
description: "Use runtime-context for request-scoped values."
---

# Example: Request Context

```ts
import { createContext } from "@sx/runtime-context";

const requestContext = createContext<{
  requestId: string;
  userId?: string;
}>();

async function loadAccount() {
  const request = requestContext.get();

  if (!request?.userId) {
    return null;
  }

  return fetch(`/accounts/${request.userId}`, {
    headers: {
      "x-request-id": request.requestId,
    },
  });
}

export async function handleRequest(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const userId = request.headers.get("x-user-id") ?? undefined;

  return requestContext.provider({ requestId, userId }).run(async () => {
    const account = await loadAccount();
    return Response.json({ account });
  });
}
```

The request metadata is declared once at the boundary and then read by internal
helpers without widening every function signature.
