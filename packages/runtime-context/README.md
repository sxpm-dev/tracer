# @sx/runtime-context

This is an independent original library. For the integrated recording sessions and
installable dashboard, see the [documentation index](../../docs/README.md) and
[migration guide](../../docs/migration.md). The performance section links dated Node 22/24 measurements; rerun benchmarks on
your target runtime before relying on them.

`React.createContext` for plain JS. Store-only — no providers component, no consumer subscriptions, no re-rendering. Just a value scoped to a function call that survives `await`.

- **Tiny** — one file, no dependencies.
- **Survives `await`** — reading a context value inside an async function continues to work after `await`, without patching `Promise` or relying on `AsyncLocalStorage`.
- **Symmetric to `React.createContext`** — `createContext()`, `.provider(value).run(fn)`, `.get()`. The mental model is the same; the lifecycle isn't tied to React.

## Install

```bash
npm install @sx/runtime-context
# or
yarn add @sx/runtime-context
```

## Quick start

```ts
import { createContext } from "@sx/runtime-context";

const requestContext = createContext<{ userId: string; traceId: string }>();

async function main() {
  const { userId, traceId } = requestContext.get()!;
  console.log("hello", userId, "(trace", traceId, ")");
  await loadProfile();
  finalize();
}

async function loadProfile() {
  const { userId } = requestContext.get()!;
  // ... fetch profile for userId
}

function finalize() {
  const { traceId } = requestContext.get()!;
  // ... emit trace
}

requestContext
  .provider({ userId: "u1", traceId: "abc" })
  .run(main);
```

`requestContext.get()` inside `main`, `loadProfile`, and `finalize` all see the same `{ userId, traceId }`, including after the `await`.

## API

### `createContext<T>(defaultValue?)`

Creates a new context. If `defaultValue` is given, `.get()` returns it when no provider is active.

```ts
const a = createContext<number>();              // .get(): number | undefined
const b = createContext<number>(0);             // .get(): number
```

### `context.provider(value).run(fn)`

Runs `fn` with `value` bound to `context`. Returns whatever `fn` returns. If `fn` returns a `Promise`, the binding survives until the promise settles.

```ts
const result = ctx.provider({ id: 1 }).run(() => {
  return doWork();           // doWork() sees { id: 1 }
});
```

Async:

```ts
const result = await ctx.provider({ id: 1 }).run(async () => {
  await first();
  await second();
  return done();             // all three see { id: 1 }
});
```

### `context.get()`

Returns the value of the innermost active provider for this context, or the `defaultValue`, or `undefined`.

```ts
ctx.provider(1).run(() => {
  ctx.provider(2).run(() => {
    ctx.get();              // 2
  });
  ctx.get();                // 1
});
ctx.get();                  // defaultValue ?? undefined
```

### `capture(fn)`

Snapshots the current context and returns a wrapped function that re-establishes that context whenever it's called. Use it when scheduling work across a task boundary that breaks the `await` chain (`setTimeout`, `setImmediate`, event listeners, etc.).

```ts
import { capture, createContext } from "@sx/runtime-context";

const ctx = createContext<number>();

await ctx.provider(1).run(async () => {
  ctx.get();                                       // 1 — sync read
  setTimeout(
    capture(() => console.log(ctx.get())),         // 1 — captured at schedule time
    0,
  );
});
```

The capture happens at the moment `capture(fn)` is *called*, not when the returned function runs. Calling the wrapped function later — even after the original scope has ended — re-establishes the snapshotted context for the duration of the call, then restores whatever was active before.

```ts
const later = ctx.provider(7).run(() => capture(() => ctx.get()));
later();                              // 7
ctx.provider(99).run(() => later());  // 7 — capture wins over the active scope
```

Arguments and `this` are forwarded to the wrapped function, so it's safe to use anywhere a regular function would go.

## Async semantics

The binding propagates through `await` because the package keeps a named async frame on V8's async stack while the awaited promise is pending. When `.get()` is called from a resumed continuation, it walks the stack to find the right frame.

The cases that work:

```ts
// ✅ Synchronous read inside the run
ctx.provider(1).run(() => ctx.get()); // 1

// ✅ Read after await inside an async run
await ctx.provider(1).run(async () => {
  await something();
  return ctx.get();          // 1
});

// ✅ Read from a function called inside an async run
async function readLater() {
  await something();
  return ctx.get();          // 1
}
await ctx.provider(1).run(() => readLater());

// ✅ Concurrent provider scopes stay separated
const a = ctx.provider("a").run(async () => { await x(); return ctx.get(); });
const b = ctx.provider("b").run(async () => { await x(); return ctx.get(); });
// a → "a", b → "b"
```

The cases that don't (and the workaround):

```ts
// ❌ Fire-and-forget — promise is not returned to .run
let dangling: Promise<unknown>;
ctx.provider(1).run(() => {
  dangling = doAsync();      // .run sees a sync return, no async wrap installed
});
await dangling;
// doAsync's `await ctx.get()` returns undefined

// ❌ Task boundaries (setTimeout, setImmediate, event listeners)
ctx.provider(1).run(() => {
  setTimeout(() => ctx.get(), 0);   // undefined — new task, no async chain
});
```

To fix the fire-and-forget case, return the promise from the callback:

```ts
await ctx.provider(1).run(() => doAsync());
```

To fix the task-boundary case, use `capture`:

```ts
ctx.provider(1).run(() => {
  setTimeout(capture(() => ctx.get()), 0);   // 1
});
```

This package does not automatically propagate across unrelated task boundaries. `AsyncLocalStorage` has different propagation semantics; do not assume the same behavior. Use `capture` for explicit callback propagation here.

## Performance

The [2026-11-11 benchmark report](../../docs/benchmarks/context-2026-11-11.md)
contains fresh runs on Node 22.16.0 and 24.11.1, raw output, hardware, units, and
limitations. These are context-access benchmarks, not full tracer measurements.

| Task | Node 22 context ns | Node 22 ALS ns | Node 24 context ns | Node 24 ALS ns |
| --- | ---: | ---: | ---: | ---: |
| 100 synchronous reads | 466–468 | 840–841 | 462–463 | 1,213–1,216 |
| 10 function calls, one read each | 96–98 | 140–142 | 80–102 | 477–517 |
| 3 contexts × 5 reads | 184–187 | 246–247 | 160–164 | 1,234–1,248 |
| Empty provider/run scope | 41–44 | 54 | 29 | 372–385 |
| 3 awaits, 4 context reads | 24,398–26,082 | 1,254–1,291 | 23,388–24,101 | 611–623 |
| 3 awaits, read once into local | 1,585–1,638 | 1,158–1,181 | 421–423 | 580–581 |

Values are ranges of whole-task mean nanoseconds across two process runs; lower
is better. Synchronous tasks favored this implementation in these runs; repeated
post-await reads strongly favored ALS. Capturing the value once locally avoids
stack recovery but changes the application's access pattern.

Read [the ALS comparison](../../docs/async-local-storage.md) for why, propagation
gaps, and safety limits. Prefer ALS for general Node request context. Runtime
coverage, memory behavior, and application latency require their own validation.

```sh
yarn bench:context
```

## How it works

When `.run(fn)` runs, the value is pushed onto a sync stack (`currentFrame`) and popped on return. While that frame is active, `.get()` walks the sync chain.

When `fn` returns a promise, the package wraps the promise in a pre-built async function whose name encodes a numeric slot id (`__sx_ctx__7`). The named frame sits on V8's async stack while the promise is pending. A `.get()` from a resumed continuation creates a fresh `Error()`, parses its stack for `__sx_ctx__N`, and looks up the frame in a side map.

Identical technique to what [`@sx/tracer`](../tracer) uses for `marker()` after `await`. The two packages don't share code — each only has the few-dozen lines it needs — but they could.

## Engine compatibility

The propagation-across-`await` trick depends on the JS engine emitting **named asynchronous frames in `Error.stack`** — the engine has to (a) include the async caller chain in the stack string, and (b) print function names so our `__sx_ctx__<slot>` markers are recoverable.

| Engine | Sync `provider/.get` | Cross-`await` `.get` |
|---|---|---|
| V8-based runtimes (Chrome, Node, Edge, Deno) | ✅ | Depends on async stack frames; verify |
| SpiderMonkey (Firefox 95+) | ✅ | ⚠️ engine-dependent; verify your target version |
| JavaScriptCore (Safari 16+) | ✅ | ⚠️ engine-dependent; sync-only is the safe assumption |

Synchronous usage (read context inside a `run` callback) does not require async stack recovery. Cross-`await` recovery depends on the engine giving us a usable async stack. If you target older Safari or rely on async recovery in browsers other than V8-based ones, prefer the **capture-local pattern** (read once at the top of an async function, use the local from then on) — it works regardless of stack format.

## What this isn't

- **Not React Context.** No components, no subscriptions, no re-renders. If a provider's value changes, consumers don't get notified. Set the value once at the boundary of a logical operation; read it inside.
- **Not `AsyncLocalStorage`.** AsyncLocalStorage propagates across every microtask hop (including setTimeout, event listeners, etc.) using runtime-integrated async context support. This package only propagates through `await` chains that pass through `.run`. The trade is portability (works in browsers) for completeness.
- **Not a service locator.** Use it for ambient context — request id, current user, locale, telemetry tags. Not for arbitrary dependency injection.

## License

MIT.
