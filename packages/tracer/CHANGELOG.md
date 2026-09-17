# Changelog

## 0.1.0

Initial release after a substantial rework. The package is now scope-based with a deliberately small surface.

### Public API

- `trace(fn, options?)` — wraps a function. No-op when called outside a recording scope.
- `marker(name, data?)` — records an inline marker on the active traced frame. Returns `void`.
- `@Trace` — decorator. Applied to a method, wraps it; applied to a class, wraps every prototype method.
- `trace.collect(fn)` — opens a scope, runs `fn`, returns `{ ray, result, names, events }`. Auto-cleans the heap on exit.
- `trace.step(name, fn)` — named child scope inside an active traced frame.
- `trace.subscribe(cb)` — global event listener for telemetry forwarders. Returns an unsubscribe function.

### Behavior

- Traced functions outside any scope are a fast-path direct call (~2.9× the cost of an unwrapped call).
- Marker recovery after `await` works for `trace`-wrapped async functions and for plain async functions awaited from a wrapped parent. Fire-and-forget plain async cannot be attributed (would require patching `Promise`).
- Internal stack-frame format is `__sx_trace__<slot>` (pooled). `trace.frameFromStack` is no longer public; markers and ray recovery are managed internally.
- Memory: per-event storage is parallel scalar arrays plus a sparse `extras` map; `TraceEvent` shapes are synthesized on read. `heaps` Map has an LRU cap of 1024 entries.

### Performance (Node 22, 10-deep call chain)

| Workload | Per-iter |
|---|---|
| Plain function call (baseline) | ~83 ns |
| `trace(fn)()` outside scope | ~233 ns |
| `trace.collect(() => fn())` in scope | ~2,580 ns |
| In scope + `captureStack: true` | ~7,400 ns |
| In scope + one `marker()` per call | ~3,870 ns |

Run `yarn bench` for the full table.

### Decorator support

`@Trace` uses legacy (TypeScript stage 2) decorator semantics. Enable `experimentalDecorators: true` in your `tsconfig.json` to use it. Stage 3 decorator support depends on the bundler/transformer used by the consumer; we will switch the default once esbuild/vitest land stage 3 support broadly.
