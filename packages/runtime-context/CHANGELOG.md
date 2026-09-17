# Changelog

## 0.1.0

Initial release.

### Public API

- `createContext<T>(defaultValue?)` — creates a context. With a default, `.get()` returns `T`; without, `T | undefined`.
- `context.provider(value).run(fn)` — runs `fn` with `value` bound. Returns whatever `fn` returns. If `fn` returns a `Promise`, the binding survives until it settles.
- `context.get()` — returns the innermost active value, or the default, or `undefined`.
- `capture(fn)` — snapshots the active context and returns a wrapped function that re-establishes it on call. For crossing task boundaries (`setTimeout`, `setImmediate`, event listeners) that break the `await` chain.

### Behavior

- Synchronous reads walk an in-memory frame chain.
- Reads after `await` walk the JS engine's async stack to recover the active frame via a pool of pre-allocated async wrappers (named `__sx_ctx__<slot>`). Reliable on V8 (Chrome, Node 12+, Edge, Bun, Deno); engine-dependent on SpiderMonkey/JavaScriptCore.
- Concurrent provider scopes are isolated by slot.
- The current frame is restored on synchronous throw and on awaited rejection.
- Fire-and-forget plain async (a promise not returned from the `.run` callback) does not propagate context — same limitation as forgetting to `run` an `AsyncLocalStorage`.
- Provider values of `undefined`, `null`, `0`, and `""` are returned as-is from `.get()`. The `defaultValue` only applies when no provider for that context is active.

### Why this exists

A drop-in replacement for the React Context mental model when you're outside a React tree — request context, current user, telemetry tags, locale. No re-rendering, no subscriptions, no patching of built-ins.
