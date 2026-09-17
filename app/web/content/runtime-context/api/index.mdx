---
title: "@sx/runtime-context API"
description: "API reference for createContext, provider().run, get, and capture."
---

# `@sx/runtime-context`

`@sx/runtime-context` exposes a small store-only context API. It feels like
`React.createContext`, but it is not tied to components, subscriptions, or
rendering.

## `createContext<T>(defaultValue?)`

Creates a context object.

```ts
import { createContext } from "@sx/runtime-context";

const optional = createContext<{ id: string }>();
const withDefault = createContext({ locale: "en" });
```

If no provider is active, `.get()` returns the default value when one was
provided, otherwise `undefined`.

## `context.provider(value).run(fn)`

Runs a callback with `value` bound to the context.

```ts
const result = ctx.provider({ id: 1 }).run(() => {
  return doWork();
});
```

If `fn` returns a promise, the binding remains available until the promise
settles, as long as the async work is returned from `.run`.

```ts
await ctx.provider({ id: 1 }).run(async () => {
  await firstStep();
  return secondStep();
});
```

Nested providers are stack-like: the innermost provider wins, then the previous
value is restored.

## `context.get()`

Reads the active value.

```ts
ctx.provider("outer").run(() => {
  ctx.provider("inner").run(() => {
    ctx.get(); // "inner"
  });

  ctx.get(); // "outer"
});
```

Prefer one read near the top of hot async functions, then pass the local value
through the rest of that function. That avoids repeated async-stack recovery
work after `await`.

## `capture(fn)`

Snapshots the current context frame and returns a wrapped function that restores
that frame when called.

```ts
import { capture, createContext } from "@sx/runtime-context";

const ctx = createContext<number>();

ctx.provider(1).run(() => {
  setTimeout(
    capture(() => {
      console.log(ctx.get()); // 1
    }),
    0,
  );
});
```

Use `capture` for task boundaries such as timers, event listeners, and callbacks
that execute after the original call stack has ended.
