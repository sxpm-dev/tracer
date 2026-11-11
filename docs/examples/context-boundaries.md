# Context at awaits and callback boundaries

[Examples](./README.md) · [ALS comparison](../async-local-storage.md)

These examples use the independent `@sx/runtime-context` package, not the recording
runtime. They do not need `?install-tracing`. Run them against the built package.

## Capture once when a function owns the whole operation

```ts
import { createContext } from '@sx/runtime-context';

const request = createContext<{ id: string }>();
await request.provider({ id: 'request-a' }).run(async () => {
  const context = request.get();
  await Promise.resolve();
  await Promise.resolve();
  console.log(context?.id); // request-a; no post-await context lookup.
});
```

Use this when a stable local value is appropriate. It does not automatically
provide context to other helpers, and it does not deep-clone the stored object.

## Explicitly bind a synchronous timer callback

```ts
import { capture, createContext } from '@sx/runtime-context';

const request = createContext<{ id: string }>();
const later = request.provider({ id: 'request-b' }).run(() =>
  capture(() => console.log(request.get()?.id)),
);

await new Promise<void>(resolve => {
  setTimeout(() => { later(); resolve(); }, 0);
});
// request-b, even though the original synchronous provider has returned.
```

`capture` snapshots the active frame reference when called and restores it for
the callback invocation. It retains references, not serialized values. Capturing
outside a provider does not retroactively acquire context. This example uses a
synchronous callback: the current `capture` implementation does not install a new
async slot for an arbitrary promise returned by the callback. Do not infer that
all future awaits inside a captured async function are covered after its original
provider has ended.

For tracing metadata, use a captured ray handle instead; unlike this context
callback, a ray handle deliberately cannot write after the recording ends.
[Ray metadata examples](./ray-metadata.md).

## ALS timer propagation on Node

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

const request = new AsyncLocalStorage<{ id: string }>();
await new Promise<void>(resolve => {
  request.run({ id: 'request-c' }, () => {
    setTimeout(() => {
      console.log(request.getStore()?.id); // request-c
      resolve();
    }, 0);
  });
});
```

The timer is created inside `run`; the callback executes later with its associated
store. That behavior does not require reading or parsing an error stack. See the
[ALS documentation](https://nodejs.org/api/async_context.html) for custom async
resources and callback-library context loss.
