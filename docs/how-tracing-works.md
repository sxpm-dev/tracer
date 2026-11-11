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
