# How tracing works

[Documentation index](./README.md)

## Error stacks as a context lookup

The core idea is to use a JavaScript error stack as evidence of the active async
call chain. Creating `new Error()` and reading `.stack` does not throw an
exception. The runtime looks for a named wrapper frame and retrieves the scope
associated with that frame's numeric slot.

Conceptually:

```text
traced call → active synchronous frame
            → returned promise → named async wrapper kept alive
                               → resumed code reads Error().stack
                               → wrapper slot identifies the active trace
```

The implementation is in [`runtime.ts`](../packages/tracing/src/runtime.ts):
`buildAsyncSlot`, `takeAsyncSlot`, `keepAsyncStackFrame`, and `frameFromStack` are the
relevant helpers. The original tracer and runtime-context library use related
techniques with their own scope lifecycles.

Synchronous calls use active in-memory state. Stack recovery is used where async
ownership would otherwise be lost. The library does not patch global promises,
timers, or event targets, and does not use Node's `AsyncLocalStorage`.

## Why async code needs more than a global variable

While a synchronous function runs, the tracer can push an active frame, run the
function, then restore the previous frame in `finally`. Nested functions see that
frame without allocating or parsing an error stack on every read.

An `await` returns control to the caller. Another operation can run before the
first resumes. Keeping “the current request” in a single global variable would
mix concurrent operations; restoring that variable immediately loses the first
operation's async identity. The missing information is **which pending operation
owns this continuation**, not just which function name appears in the source.

## Follow a recording through the implementation

| Step | State | Why it exists |
| --- | --- | --- |
| Enter a wrapped function | Push its heap, name, and event ID on synchronous active stacks | Cheap nested attribution while the call is on the stack |
| Function returns a promise | Allocate an unused slot and map it to that call's context | Different in-flight operations need distinct identities |
| Await inside the named wrapper | A function name contains the slot ID | The engine can expose this suspended caller in an async stack |
| Resume and recover | Read the stack, match the slot name, consult the map | Recover the call context without passing it as an argument |
| Promise settles | Release the slot and remove its lookup entry in `finally` | Avoid reusing an identity while an earlier operation is pending |

The stack contains an identifier; the metadata and values stay in memory. The
library is not parsing customer data out of error messages. Slot entries cannot
be reused while their promises are in flight. The pool may grow with concurrent
pending operations; it is not a fixed concurrency or memory limit.

The integrated tracer uses `__editor_platform_trace__N` internally; the independent
context library uses `__sx_ctx__N`. These are implementation identifiers, not
public tracing names or consumer metadata keys. `@sx/runtime-context` uses
`Error.captureStackTrace` when available, with a `new Error().stack` fallback;
`@sx/tracing` currently reads `new Error().stack` directly. The implementations
share an idea, not identical instruction counts.

## A small runnable demonstration of the idea

Run this as an ES module on a V8-based Node runtime. It demonstrates one slot,
not a production context library. No exception is thrown:

```js
const slots = new Map([[7, { requestId: 'request-42' }]]);

async function __demo_scope__7(promise) {
  return await promise; // Keep a named awaited caller in the async chain.
}

async function operation() {
  await Promise.resolve();
  const stack = new Error().stack ?? '';
  const match = stack.match(/__demo_scope__(\d+)/);
  console.log(match ? slots.get(Number(match[1])) : 'No matching async frame');
}

await __demo_scope__7(operation());
slots.delete(7);
// On the tested Node runtimes: { requestId: 'request-42' }
```

A representative stack contains `at async __demo_scope__7 (...)`. File locations,
other frames, and formatting vary. The production code adds reusable slots,
concurrent scope tracking, synchronous fast paths, cleanup, tracing events, and
capture modes. Do not copy this single-slot demonstration into request handling.

V8 can reconstruct certain awaited caller frames without continuously recording
a separate stack. That does **not** make creating, formatting, and parsing an
error stack free. The `.stack` API is engine-specific; format hooks and stack
limits affect it. [V8 stack-trace API](https://v8.dev/docs/stack-trace-api).

## Ownership is different from extra diagnostic data

Stack recovery helps attribute calls. To attach consumer data to a known ray,
capture `getActiveTraceRay()` synchronously and pass that handle explicitly after
`await`. This avoids requiring a second inference of ownership for the metadata
write. The handle is tied to one recording and becomes invalid after release.
See [concurrent ray examples](./examples/ray-metadata.md).

Metadata values are JSON snapshots, but context-library values are ordinary shared
references. Neither mechanism creates an isolated copy of the entire application
state. [ALS comparison and safety](./async-local-storage.md) explains the distinction.

## What the technique does not guarantee

Stack strings and async caller frames depend on the JavaScript engine, stack
settings, and transformed code. Test the actual browser and production bundle
used by your application. Do not infer universal runtime support from a build
success or a Node unit test. Minification, frame naming, and async transforms
matter when a lookup depends on named frames.

Unreturned work and unrelated timer/event callbacks do not necessarily retain
an await chain. Explicit ray handles support metadata updates across callbacks;
they do not turn arbitrary async work into a distributed trace. See
[metadata handles](../packages/tracing/EXTENDING.md#attach-metadata-to-a-ray).

With `captureAsyncContext: false`, full mode keeps synchronous nesting and timing
but skips stack recovery across awaits. Light mode aggregates function activity
instead of retaining full call trees. Neither option should be presented as an
exact replacement for a full async call graph.

## Application exceptions are a separate path

Traced functions preserve return values and rethrow the original thrown or
rejected value. The recording stores a bounded diagnostic snapshot of that error.
[`errorSnapshot.ts`](../packages/tracing/src/errorSnapshot.ts) handles circular,
large, and uninspectable values without substituting a new application error.
Argument capture is a separate opt-in; error capture does not require recording
the failed call's arguments.

```ts
import { trace, startRecording, releaseRecording } from '@sx/tracing';

const failure = new Error('Example failure');
const fail = trace(() => { throw failure; }, 'fail', { namespace: 'example' });
startRecording({ cpu: false });
try {
  fail();
} catch (error) {
  console.assert(error === failure);
} finally {
  console.log(releaseRecording());
}
```

This example requires the installation flag described in the
[first-recording guide](./getting-started.md). Application failure and transport
failure are separate concerns: `releaseSession` can reject even if the operation
itself succeeded.

## Cost and interpretation

Reading and parsing stacks costs time. Capturing arguments, browser signals, and
serializing/uploading records add different costs. Measure these separately;
there is no blanket zero-overhead claim. Nested and asynchronous durations can
overlap, so summing them does not measure wall-clock time or CPU utilization.
See [performance and evidence](./performance.md).

## What can break recovery in the current code?

| Condition | Consequence and response |
| --- | --- |
| Wrapper frame omitted or truncated | Lookup may fail; retain explicit handles/locals when correctness depends on ownership. |
| Custom `Error.prepareStackTrace` returns a non-string or throws | Current recovery paths call string `.match`; instrumentation may throw. This is not automatically isolated. Test other observability tools together. |
| Promise/async transforms change the caller chain | A development build's result does not prove production attribution. Validate the shipped bundle. |
| Timer, callback library, or fire-and-forget work leaves the awaited chain | No universal implicit propagation; use explicit context/handles or the context library's `capture` where appropriate. |
| Pending work never settles | Slot state can remain retained; bound work and recording lifetime. |
| Arbitrary code forges an internal-looking frame or modifies globals | Stack-derived identity is not an authorization or tenant-isolation boundary. |

Do not increase `Error.stackTraceLimit` globally as a universal fix: it changes
cost and behavior for other stack consumers too. Full capture without async
recovery is an explicit accuracy/cost choice, not a fallback proving identical
parent relationships. See the [measured ALS comparison](./async-local-storage.md).
