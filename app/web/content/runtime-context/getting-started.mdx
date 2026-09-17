---
title: "Getting Started"
description: "Install @sx/runtime-context and read your first scoped value."
---

# Getting Started

Install the runtime context package:

```bash
npm install @sx/runtime-context
```

Or with Yarn:

```bash
yarn add @sx/runtime-context
```

## First scoped value

```ts
import { createContext } from "@sx/runtime-context";

const requestContext = createContext<{ userId: string; traceId: string }>();

async function loadProfile() {
  const request = requestContext.get();
  return fetch(`/api/users/${request?.userId}`);
}

await requestContext
  .provider({ userId: "u1", traceId: "req_123" })
  .run(() => loadProfile());
```

The value is bound to the operation started by `.run`. Helpers can call `.get()`
without receiving the value as an explicit argument.

## Use `capture` for scheduled callbacks

```ts
import { capture } from "@sx/runtime-context";

requestContext.provider({ userId: "u1", traceId: "req_123" }).run(() => {
  setTimeout(capture(() => requestContext.get()), 0);
});
```

`capture` snapshots the current context at scheduling time and restores it when
the callback runs.

## Repository commands

From this repository root:

```bash
yarn install
yarn build
yarn test
yarn typecheck
yarn dev:web
```

The runtime-context docs live under `/runtime-context`.
