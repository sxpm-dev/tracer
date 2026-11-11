# Error-stack context versus AsyncLocalStorage

[Documentation index](./README.md) · [Stack mechanism](./how-tracing-works.md) · [Benchmark results](./benchmarks/context-2026-11-11.md)

Use Node's `AsyncLocalStorage` (ALS) as the default for Node request context when
you need propagation through normal asynchronous work. Stack-based recovery is
useful for the browser-oriented instrumentation design here, but narrower in
coverage and more sensitive to engine behavior. A fast synchronous microbenchmark
is not sufficient reason to replace production request context.

## Compare equivalent responsibilities

`@sx/runtime-context` and ALS both provide scoped ambient values. The benchmark
compares those two APIs. `@sx/tracing` additionally records calls, timing, markers,
errors and samples; `@sx/recordings` adds transport. ALS alone does none of that.
There is no ALS-based full tracer in this repository, so the tables do not establish
that this tracer beats an equivalent ALS tracer.

| Concern | Stack-based context in this repo | Node AsyncLocalStorage |
| --- | --- | --- |
| Core idea | Recover an in-memory frame through synchronous state or a named awaited frame in an error stack | Associate a store with the runtime's asynchronous execution context |
| Normal read | Walk the current context-frame chain | `getStore()` retrieves the active store |
| Read after an await | Capture/format a stack, locate a wrapper slot, then read its context | Read the propagated store without parsing an error stack |
| Timer/callback boundaries | Await-chain recovery is insufficient; explicit callback capture can help | Runtime-created async work inside `run` normally inherits the store |
| Browser availability | No Node dependency; async recovery still depends on engine behavior | Node API, not a native browser API |
| Input mutation | Stored values are shared references | Stores are shared references |
| Full tracing features | Separate tracing package supplies them | Must be built or integrated separately |
| Cross-process propagation | Not automatic | Not automatic |

ALS is a stable, optimized Node API. Custom callbacks/thenables can still lose
context and may need `AsyncResource`; `bind` and `snapshot` support explicit
context capture. Prefer `run` for scoped work rather than casually changing the
rest of synchronous execution with `enterWith`. These are API-level properties,
not a claim about every Node version's internal implementation.
[Node asynchronous context documentation](https://nodejs.org/api/async_context.html).

## Equivalent API examples

Both snippets return `request-42` on the tested Node runtimes. They create separate
contexts; neither needs the tracing installation URL flag.

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

const request = new AsyncLocalStorage<{ id: string }>();
const id = await request.run({ id: 'request-42' }, async () => {
  await Promise.resolve();
  return request.getStore()?.id;
});
console.log(id);
```

```ts
import { createContext } from '@sx/runtime-context';

const request = createContext<{ id: string }>();
const id = await request.provider({ id: 'request-42' }).run(async () => {
  await Promise.resolve();
  return request.get()?.id;
});
console.log(id);
```

The similar call sites hide a different cost model: the second snippet must
recover the suspended frame after the await. See the [measured tables](./benchmarks/context-2026-11-11.md).

## Why can the synchronous path be fast?

In this implementation, a provider pushes an in-memory frame and restores the
previous pointer. When a synchronous frame is already active, `get()` does not
read an error stack. Shallow scope chains and repeated simple reads are favorable
cases for small, JIT-optimized JavaScript functions.

This is a source-based explanation, not a measured CPU profile. ALS's own cost
changes between runtimes and workloads. Avoid the outdated explanation that ALS
always pays for one particular `async_hooks` implementation; Node internals evolve.

## Why can repeated async reads be slow?

Stack creation, formatting and regular-expression lookup happen on resumed reads
when synchronous state is unavailable. Repeating the lookup after each await pays
that cost repeatedly. ALS carries the store with asynchronous execution rather
than rediscovering it from text. The relative cost is especially visible in a
microbenchmark doing almost no useful work between awaits.

One alternative, if it suits your code, is to read once at entry:

```ts
import { createContext } from '@sx/runtime-context';
const request = createContext<{ id: string }>();

await request.provider({ id: 'request-42' }).run(async () => {
  const context = request.get(); // Synchronous lookup while provider is active.
  await Promise.resolve();
  console.log(context?.id);     // Local read, no context recovery.
});
```

This does not optimize arbitrary downstream helpers that independently call
`get()`. You have changed how the application accesses context. The benchmark
includes capture-local variants for both implementations so the comparison is
explicit. [Callback capture examples](./examples/context-boundaries.md).

## Is it safe?

“Safe” has several different meanings:

- **Correct attribution:** the supported await patterns and concurrent scopes have
  regression coverage. That is not proof for every engine, bundler, timer, custom
  thenable, or instrumentation combination. Missing async frames can lose context.
- **Application behavior:** traced application errors are rethrown, but the
  instrumentation itself is not universally non-throwing. In particular, a custom
  stack formatter returning a non-string can break current `.match`-based recovery.
- **Security:** use explicit validated request context or established runtime
  propagation for authorization and tenant routing. A parsed function-name marker
  is not a security identity or a boundary against hostile code in the same realm.
- **Memory:** pending promises retain slot/context state; captured callbacks retain
  references. Full recordings and custom samples need bounded lifetimes and volumes.
  Batch size alone does not bound total memory.
- **Privacy:** context values, error snapshots and custom payloads may contain
  sensitive data. Opt in deliberately and emit small redacted diagnostic fields.

ALS also does not make mutable store objects immutable or propagate data across
network/process boundaries. Choosing ALS does not remove application lifecycle,
privacy, or schema responsibilities.

## Gaps and practical choice

| Requirement | Practical choice |
| --- | --- |
| Node request identity through I/O, timers and application libraries | ALS, with context-loss tests at unusual boundaries |
| Browser call-tree inspection and the dashboard here | This tracing runtime, tested with the deployed browser/bundle |
| A known operation's extra diagnostic metadata | Explicit ray handle and namespaced metadata |
| Repeated values inside one function | Capture the value once locally if semantics allow |
| Distributed tracing or a production authorization boundary | A separate propagation/security design; neither error stacks nor ALS alone provides it |

Measure your actual workload. The [benchmark report](./benchmarks/context-2026-11-11.md)
records units, environment, results, and limitations instead of presenting one
universal “faster than ALS” claim.
