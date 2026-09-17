# @sx/runtime-context

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

This is the same kind of limitation `AsyncLocalStorage` has if you forget to `run` over a promise. It's structural — fixing it transparently would require patching `Promise.prototype.then` and the timer/event APIs, which this package deliberately doesn't do.

## Performance

Numbers from `yarn bench` on Node 22, paired against Node's `AsyncLocalStorage` (`als`) and a plain module-level global (`global`).

| Workload | `@sx/runtime-context` | `AsyncLocalStorage` | `global` |
|---|---|---|---|
| Hot read × 100 | **493 ns** | 845 ns | 74 ns |
| Handler: 10 fn × 1 read | **105 ns** | 136 ns | 36 ns |
| Multi: 3 contexts × 5 reads | **181 ns** | 241 ns | — |
| `provider().run(noop)` | **39 ns** | 54 ns | — |
| **Async: 3 awaits, 4 reads** | 24,833 ns | **1,270 ns** | 1,167 ns |
| Async, *capture-local* pattern | 1,619 ns | **1,151 ns** | — |

**The picture:**

- **Sync usage — `runtime-context` is faster than `AsyncLocalStorage`** by 1.3-1.7×. ALS pays for hooking into Node's `async_hooks` even on sync calls; we don't have that overhead.
- **Async usage where you read context many times across awaits — `AsyncLocalStorage` is dramatically faster** (~19× on the worst case). Node threads the store through every async boundary natively via `async_hooks`; we walk the stack with `new Error().stack` to recover the active frame after each `await`, and that costs ~6 μs per walk.
- **Async usage with the *capture-local* pattern — both are essentially equal** and close to plain async. Read the context once at the top of the async function, then use the local.

```ts
// ❌ pays a ~6 μs stack walk on each get after await
async function slow() {
  step();              // ctx.get() inside
  await db.query();
  step();              // walk
  await network.send();
  step();              // walk
}

// ✅ one read at the top, local everywhere else — ~1.5 μs total
async function fast() {
  const env = ctx.get();   // sync read, ~5 ns
  step(env);
  await db.query();
  step(env);               // local
  await network.send();
  step(env);               // local
}
```

**When to pick which:**

- **`AsyncLocalStorage`** if you're Node-only and you do a lot of `ctx.get()` across many awaits without restructuring to capture-local.
- **`@sx/runtime-context`** if you need browser support, want a smaller dependency footprint (~135 LOC vs Node's `async_hooks` machinery), have sync-heavy reads, or are willing to follow the capture-local pattern in async code. The capture-local version is competitive with ALS.

Run them yourself:

```bash
yarn workspace @sx/runtime-context bench
```

## How it works

When `.run(fn)` runs, the value is pushed onto a sync stack (`currentFrame`) and popped on return. While that frame is active, `.get()` walks the sync chain.

When `fn` returns a promise, the package wraps the promise in a pre-built async function whose name encodes a numeric slot id (`__sx_ctx__7`). The named frame sits on V8's async stack while the promise is pending. A `.get()` from a resumed continuation creates a fresh `Error()`, parses its stack for `__sx_ctx__N`, and looks up the frame in a side map.

Identical technique to what [`@sx/tracer`](../tracer) uses for `marker()` after `await`. The two packages don't share code — each only has the few-dozen lines it needs — but they could.

## Engine compatibility

The propagation-across-`await` trick depends on the JS engine emitting **named asynchronous frames in `Error.stack`** — the engine has to (a) include the async caller chain in the stack string, and (b) print function names so our `__sx_ctx__<slot>` markers are recoverable.

| Engine | Sync `provider/.get` | Cross-`await` `.get` |
|---|---|---|
| V8 (Chrome, Node 12+, Edge, Bun, Deno) | ✅ | ✅ |
| SpiderMonkey (Firefox 95+) | ✅ | ⚠️ engine-dependent; works on recent versions |
| JavaScriptCore (Safari 16+) | ✅ | ⚠️ engine-dependent; sync-only is the safe assumption |

Sync usage (the common path — read context inside a `run` callback) is portable everywhere. Cross-`await` recovery depends on the engine giving us a usable async stack. If you target older Safari or rely on async recovery in browsers other than V8-based ones, prefer the **capture-local pattern** (read once at the top of an async function, use the local from then on) — it works regardless of stack format.

## What this isn't

- **Not React Context.** No components, no subscriptions, no re-renders. If a provider's value changes, consumers don't get notified. Set the value once at the boundary of a logical operation; read it inside.
- **Not `AsyncLocalStorage`.** AsyncLocalStorage propagates across every microtask hop (including setTimeout, event listeners, etc.) by patching the runtime. This package only propagates through `await` chains that pass through `.run`. The trade is portability (works in browsers) for completeness.
- **Not a service locator.** Use it for ambient context — request id, current user, locale, telemetry tags. Not for arbitrary dependency injection.

## License

MIT.
