---
title: "@sx/runtime-context"
description: "Store-only context for plain JavaScript operations."
---

# `@sx/runtime-context`

Store-only context for plain JavaScript. It gives you the `React.createContext`
mental model without components, subscriptions, or re-rendering.

## Why this package exists

JavaScript applications often have operation-scoped values: request id, current
user, locale, tenant, feature snapshot, trace id. Passing those through every
function makes business signatures noisy, and Node's `AsyncLocalStorage` is not
available in browsers or many edge runtimes.

`@sx/runtime-context` exists for the middle ground: a tiny scoped store that
works in plain JavaScript, keeps the operation boundary explicit, and survives
ordinary `await` chains without patching promises.

## The issue it solves

Without context, helper APIs tend to grow parameters that are not part of their
domain:

```ts
async function loadProfile(userId: string, requestId: string, locale: string) {
  audit("load-profile", requestId);
  return fetchProfile(userId, locale);
}

async function renderDashboard(request: Request) {
  const env = readRequestEnv(request);
  return loadProfile(env.userId, env.requestId, env.locale);
}
```

That works, but the metadata leaks into every layer.

With runtime context, you bind the metadata once at the operation boundary:

```ts
import { createContext } from "@sx/runtime-context";

const requestContext = createContext<{
  requestId: string;
  userId: string;
  locale: string;
}>();

async function loadProfile() {
  const request = requestContext.get();
  audit("load-profile", request?.requestId);
  return fetchProfile(request!.userId, request!.locale);
}

async function renderDashboard(request: Request) {
  return requestContext.provider(readRequestEnv(request)).run(loadProfile);
}
```

The business function can stay focused on the work. The ambient operation state
still remains available where logging, auditing, localization, or correlation
needs it.

## What it is for

- request ids
- current user ids
- locales
- tenant ids
- trace ids
- feature flag snapshots

## Real examples

| Example | Why it matters |
| --- | --- |
| [Request Context](/runtime-context/examples/request-context) | Bind request metadata once, read it in internal helpers. |
| Capture scheduled callbacks | Preserve context across timer and listener boundaries with `capture`. |
| Capture-local async work | Read context once in hot async functions and use a local value after awaits. |

## Start here

```ts
import { createContext } from "@sx/runtime-context";

const requestContext = createContext<{ userId: string; traceId: string }>();

await requestContext
  .provider({ userId: "u1", traceId: "req_123" })
  .run(async () => {
    await loadProfile();
  });
```

Read [Getting Started](/runtime-context/getting-started) for the first full
example, then use the [API reference](/runtime-context/api) for exact signatures.

## When not to use it

- Use explicit parameters for core business data.
- Use `AsyncLocalStorage` when you are Node-only and need complete runtime-level
  propagation across many async boundaries.
- Use React Context for reactive UI state.
- Avoid treating runtime context as a service locator.
