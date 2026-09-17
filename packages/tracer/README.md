# @sx/tracer

Tiny tracer for browser and Node. Wraps functions to record a call tree, captures inline markers, and gets out of your way when nobody's listening.

- **Zero overhead outside a scope** — `trace(fn)()` outside `trace.collect(...)` is ~2.9× the cost of an unwrapped call. In production code you don't pay for tracing you didn't ask for.
- **One small API** — `trace`, `marker`, `@Trace`. That's it for 90% of usage.
- **No prototype patching** — does not patch `Promise`, timers, event targets, or any built-ins. Safe to drop into any environment.
- **Bounded memory** — LRU cap on retained scopes; per-event storage is parallel scalar arrays, not allocated objects. `TraceEvent` shapes are synthesized only when you read them.

## Install

```bash
npm install @sx/tracer
# or
yarn add @sx/tracer
```

If you want to use the `@Trace` decorator, enable legacy decorators in your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```

## Quick start

```ts
import { trace, marker, Trace } from "@sx/tracer";

@Trace
class UserService {
  async findUser(id: string) {
    marker("query-start", { id });
    const user = await db.users.findOne(id);
    marker("query-end", { found: !!user });
    return user;
  }
}

const service = new UserService();

// Run inside a scope to record:
const { result, names, events } = await trace.collect(() =>
  service.findUser("u1"),
);

console.log(names);
// ["UserService.findUser", "UserService.findUser.query-start", "UserService.findUser.query-end"]

console.log(events[0]?.name, events[0]?.kind);
// "UserService.findUser" "call"
```

Call `findUser` outside `trace.collect` and the tracer is a no-op — no allocation, no record, almost no cost.

## Concepts

### Scopes

Tracing is **scope-based**. Functions wrapped with `trace(...)` (or `@Trace`) only record events when called inside an active scope. The canonical scope entry point is `trace.collect`:

```ts
const result = trace.collect(() => doStuff());
// result.names  — names in call order, including markers
// result.events — full TraceEvent objects (synthesized lazily)
// result.result — whatever doStuff() returned
// result.ray    — id of this scope (e.g. for correlating subscribed events)
```

When the scope ends, the heap is auto-cleared. There is no `trace.clear()` to remember.

Outside any scope, traced functions short-circuit to a direct call. This is the **fast path** — measured at ~23 ns per call (close to a bare function call).

### Markers

Drop `marker(name, data?)` anywhere inside a traced function to record an inline event:

```ts
const compute = trace(function compute(input: number[]) {
  marker("start", { size: input.length });
  const total = input.reduce((a, b) => a + b, 0);
  marker("done", { total });
  return total;
});

const { names } = trace.collect(() => compute([1, 2, 3]));
// ["compute", "compute.start", "compute.done"]
```

Markers attribute themselves to the active traced frame: a marker in `compute` shows up as `compute.<name>` in the output.

Markers also work after `await` inside a traced async function:

```ts
const load = trace(async function load(id: string) {
  marker("fetch-start");
  const data = await fetch(`/api/${id}`).then(r => r.json());
  marker("fetch-done");          // attributed correctly to `load`
  return data;
});
```

This is the part the package goes to some lengths to make work — see [Async semantics](#async-semantics).

### The `@Trace` decorator

`@Trace` wraps either a single method or every method on a class:

```ts
class Cache {
  @Trace
  get(key: string) {
    return this.store.get(key);
  }
}

@Trace
class PaymentService {
  charge(amount: number) { /* ... */ }
  refund(id: string)      { /* ... */ }
  // both methods wrapped with names "PaymentService.charge", "PaymentService.refund"
}
```

When applied to a class, the constructor is left alone — only prototype methods are wrapped. Names are prefixed with the class name (`ClassName.methodName`) so a wide trace stays readable.

### Telemetry / streaming

To forward events to an external system (OTel, Sentry, console), use `trace.subscribe`:

```ts
const unsubscribe = trace.subscribe(event => {
  myMonitoring.record({
    name: event.name,
    kind: event.kind,
    at: event.at,
    data: event.data,
  });
});

// later:
unsubscribe();
```

Subscribers fire for **every** recorded event, regardless of which scope produced it. When no subscribers are registered, the cost is a single null check per event (~2-3 ns).

### Named async sections

For ad-hoc named scopes inside an async function — useful when a logical phase doesn't deserve its own function — use `trace.step`:

```ts
const run = trace(async function run() {
  marker("loaded");
  await trace.step("validate", async () => {
    await validate();
    marker("ok");          // attributed to "validate.ok"
  });
  await trace.step("save", async () => {
    await save();
  });
});
```

Markers inside a `step` attribute to the step's name, not the surrounding function's name.

## API reference

### `trace(fn, options?): TracedFunction`

Wraps a function. Outside an active scope, the returned function calls `fn` directly with no overhead. Inside a scope, it records a `call` event before invoking `fn` and optionally records its return/error.

Options:

| Field | Type | Default | What it does |
|---|---|---|---|
| `name` | `string` | `fn.name` or `"anonymous"` | Name used in events. |
| `captureArgs` | `boolean \| (args[]) => any` | `false` | Capture call arguments. Function form lets you redact. |
| `captureResult` | `boolean \| (v) => any` | `false` | Capture return value. |
| `captureError` | `boolean \| (e) => any` | `false` | Capture thrown/rejected errors. |
| `captureTiming` | `boolean` | `false` | Record `duration` (calls `performance.now()` twice — opt-in). |
| `captureStack` | `boolean` | `false` | Attach a lazy `stack` getter to the call event. |

The returned function exposes a read-only `ray` getter — the id of the last scope it was called inside.

### `marker(name, data?): void`

Records a marker event under the currently active traced frame. No-op outside any scope. The marker's `name` in the resulting events is prefixed with the parent frame's name: `parentName.markerName`.

### `@Trace`

Class or method decorator. Applied to a method, wraps it. Applied to a class, wraps every own-property method on the prototype. Requires `experimentalDecorators: true`.

### `trace.collect(fn): { ray, result, names, events }`

Opens a recording scope, runs `fn`, and returns the captured trace. Handles both sync and async — for async, the return is a `Promise<...>`.

`events` is a lazy getter — synthesized only on first access and cached. `names` is computed eagerly because the cost is minimal.

The scope's heap is cleared on the way out. There is no `trace.clear` you need to call.

### `trace.step(name, fn)`

Runs `fn` inside a named child scope of the current traced frame. Markers inside attribute to `name`. Returns whatever `fn` returns (handles async).

### `trace.subscribe(cb): () => void`

Registers an event listener. Returns an `unsubscribe` function. The listener fires for every event pushed (calls and markers) including those resolved later from async paths.

## Async semantics

Marker-after-`await` recovery is the part that takes care:

```ts
// ✅ Wrapped async — works
const foo = trace(async function foo() {
  await something();
  marker("done");           // attributed to "foo"
});

// ✅ Wrapped async, awaited from a wrapped parent — works
const parent = trace(async function parent() {
  await foo();              // foo's marker attributes correctly
});

// ✅ Unwrapped async, awaited from a wrapped parent — works
async function unwrapped() {
  await something();
  marker("done");           // attributed via V8 async stack chain
}
const parent2 = trace(async function parent2() {
  await unwrapped();
});

// ❌ Fire-and-forget plain async — does not work
const parent3 = trace(function parent3() {
  unwrapped();              // not awaited; parent3 returns before unwrapped resumes
});
trace.collect(() => parent3());
// unwrapped's marker has nothing to anchor to and is dropped
```

The last case is structurally unfixable without patching `Promise` (which this package deliberately doesn't do). Fix it by wrapping the function — `trace(unwrapped)` or `@Trace` — or by using `trace.step("unwrapped", () => unwrapped())`.

## Performance

Benchmarks on Node 22, 10-deep call chain, depth=10:

| Workload | Per-iter | Per-call | Note |
|---|---|---|---|
| Plain function call (10 calls) | ~83 ns | ~8 ns | Baseline |
| `trace(fn)()` **outside scope** | ~233 ns | ~23 ns | Fast path — production cost |
| `trace.collect(() => fn())` (10 calls in scope) | ~2,580 ns | ~258 ns | Recording active |
| Plus `captureStack: true` | ~7,400 ns | — | Extra `new Error()` + lazy stack |
| Plus one `marker()` per call | ~3,870 ns | — | 10 calls + 10 markers |

Run them yourself:

```bash
yarn bench
```

### Memory

- Per event: ~4 scalar slots in the heap arrays plus an optional sparse extras entry. `TraceEvent` objects are created on demand by `trace.events` / `trace.collect`'s `events` getter.
- Per scope: one heap, cleared automatically when the scope ends.
- Global: heaps Map is LRU-capped at 1024 retained scopes. Beyond that, the oldest scope is evicted (its slot pool entries released, unresolved markers compacted). Long-running apps that never call `trace.collect` correctly will not leak.

## Engine compatibility

Marker recovery after `await` depends on the JS engine including named asynchronous frames in `Error.stack`.

| Engine | Sync recording | `marker()` after `await` |
|---|---|---|
| V8 (Chrome, Node 12+, Edge, Bun, Deno) | ✅ | ✅ |
| SpiderMonkey (Firefox 95+) | ✅ | ⚠️ engine-dependent |
| JavaScriptCore (Safari 16+) | ✅ | ⚠️ engine-dependent |

Sync tracing works everywhere. Async marker recovery is reliable on V8. On Firefox/Safari, prefer placing `marker()` calls *before* any `await` in the function body, or wrap the post-await portion in `trace.step("phase", ...)` — the step provides its own named frame that's reliable to recover.

## What this isn't

- **Not a logger.** It records structured events; ship them with `trace.subscribe` if you want them anywhere.
- **Not OpenTelemetry.** No spans, no contexts, no W3C tracecontext. If you need OTel, subscribe and forward — see [Telemetry / streaming](#telemetry--streaming).
- **Not an async-context library.** It records what runs inside a `trace.collect` scope. It does not propagate context across `setTimeout`, `setImmediate`, message channels, or other async edges that aren't `await`.

## License

MIT.
