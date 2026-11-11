# Extra data per tracing ray

[Examples](./README.md) · [Extension API](../../packages/tracing/EXTENDING.md#attach-metadata-to-a-ray)

Use `setTraceRayMetadata(owner, data, handle?)` to attach consumer-owned JSON data
to a particular operation. A ray groups a root traced call and its nested calls;
it is not a separate metadata object for every function invocation.

Each ray has a `metadata` map. Independent consumers own separate keys such as
`shop.request`, `cache.outcome`, and `shop.result`. Updating one owner replaces
only that owner's value on that ray. Other owners and other rays are untouched.

## 1. Request context and cache outcomes on concurrent rays

Load the application with `?install-tracing` **before importing instrumentation**.
This self-contained example uses full in-memory capture so the output can be
inspected without a server:

```ts
import {
  getActiveTraceRay,
  releaseRecording,
  setTraceRayMetadata,
  startRecording,
  trace,
} from '@sx/tracing';

const lookupProduct = trace(async (requestId: string, productId: string) => {
  // Capture synchronously at the beginning, before the first await.
  const ray = getActiveTraceRay();
  if (ray) {
    setTraceRayMetadata('shop.request', {
      version: 1,
      requestId,
      productId,
      operation: 'lookup-product',
    }, ray);
  }

  // Stand-in for application work. Both calls below can be pending together.
  await Promise.resolve();
  const hit = productId === 'product-1';
  if (ray) {
    setTraceRayMetadata('cache.outcome', {
      version: 1,
      cache: 'products',
      hit,
      source: hit ? 'memory' : 'database',
    }, ray);
    setTraceRayMetadata('shop.result', { version: 1, found: true }, ray);
  }
  return { id: productId };
}, 'lookupProduct', { namespace: 'shop' });

startRecording({ mode: 'full', cpu: false });
try {
  await Promise.all([
    lookupProduct('request-a', 'product-1'),
    lookupProduct('request-b', 'product-2'),
  ]);
} finally {
  const recording = releaseRecording();
  for (const ray of recording.traces) {
    console.log(ray.ray, ray.metadata);
  }
}
```

The two calls begin without a common traced parent, so they create two rays.
Their IDs are generated; the metadata values distinguish them:

```json
[
  {
    "shop.request": {
      "version": 1,
      "requestId": "request-a",
      "productId": "product-1",
      "operation": "lookup-product"
    },
    "cache.outcome": {
      "version": 1,
      "cache": "products",
      "hit": true,
      "source": "memory"
    },
    "shop.result": { "version": 1, "found": true }
  },
  {
    "shop.request": {
      "version": 1,
      "requestId": "request-b",
      "productId": "product-2",
      "operation": "lookup-product"
    },
    "cache.outcome": {
      "version": 1,
      "cache": "products",
      "hit": false,
      "source": "database"
    },
    "shop.result": { "version": 1, "found": true }
  }
]
```

Always pass the captured handle after an async boundary. `getActiveTraceRay()`
reads synchronous active state; it does not infer ownership after `await`.
The `if (ray)` guard matters: passing `undefined` invokes the setter's default
active-ray lookup, which is not an explicit association with your original operation.

## 2. Several consumers enrich the same ray

This example is independent of the first. A nested cache function joins its
caller's ray, so the root's request metadata and the cache's metadata appear
together. Metadata is snapshotted on assignment.

```ts
import {
  releaseRecording,
  setTraceRayMetadata,
  startRecording,
  trace,
} from '@sx/tracing';

const readCache = trace(() => {
  setTraceRayMetadata('cache.summary', { version: 1, hits: 1, misses: 0 });
  return 'cached value';
}, 'readCache', { namespace: 'cache' });

const render = trace(() => {
  const context = { version: 1, componentId: 'panel-1' };
  setTraceRayMetadata('editor.context', context);
  context.componentId = 'changed-later'; // Does not mutate recorded metadata.
  readCache();
  // Same owner replaces its previous value, rather than merging fields.
  setTraceRayMetadata('cache.summary', { version: 1, hits: 2, misses: 0 });
}, 'render', { namespace: 'editor' });

startRecording({ mode: 'full', cpu: false });
try {
  render();
} finally {
  const recording = releaseRecording();
  console.log(recording.traces[0].metadata);
  // editor.context: { version: 1, componentId: 'panel-1' }
  // cache.summary: { version: 1, hits: 2, misses: 0 }
}
```

Do not use one owner key for unrelated consumers. If you need multiple cache
observations on a ray, maintain a bounded summary under your owner, or use markers
for each timed hit/miss. Metadata writes replace values; they do not increment
counters or append to a list automatically.

## 3. Stream and inspect the same data in the dashboard

The instrumentation above works unchanged with session streaming. Import its APIs
from `@sx/recordings`, then replace the in-memory capture pair with:

```ts
import { recordSession, releaseSession } from '@sx/recordings';

await recordSession('Product lookups', {
  serverUrl: 'http://127.0.0.1:4178',
  mode: 'full',
});
try {
  // Call and await your instrumented operations here.
} finally {
  await releaseSession();
}
```

Open a saved session's **Trace frames**, select a call, and inspect **Ray metadata**.
The default inspector already displays the data; no consumer UI is required.
For a custom UI, query the selected ray through the public data API:

```ts
import { createSessionClient } from '@sx/dashboard/data';

const client = createSessionClient('http://127.0.0.1:4178');
const page = await client.frames('replace-with-session-id', {
  ray: 'replace-with-ray-id',
  offset: 0,
});
console.log(page.metadata?.['shop.request']);
console.log(page.metadata?.['cache.outcome']);
```

These values have type `unknown`: validate your consumer's `version` and payload
fields before rendering. Complete JSON/JSONL recordings expose the same data at
`recording.traces[i].metadata`. Saved-session summaries do not load every ray;
use the paged API instead of interpreting absent metadata as no observations.
Standalone summary HTML deliberately excludes raw ray metadata.

## Lifetime and limits

- Full mode is required. Light mode has no retained rays; browser-only capture
  does not create function rays.
- A handle identifies both a ray and its recording session. It stops working
  after release and must not be reused for a later recording.
- The setter returns `false` when the ray is unavailable. Invalid owners or
  unserializable/oversized data throw when writing to an available ray.
- Owner names match `[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}`. Each ray supports up to
  32 owners; each owner's JSON-encoded value is at most 16 KiB.
- Use small JSON-safe values. Do not attach credentials, full cache contents,
  or large application objects merely to identify an operation.
- The runtime streams metadata through reserved `tracing.ray-metadata` samples.
  Use the setter; do not emit that reserved channel directly.

For recording-wide data rather than per-operation metadata, use the
[cache extension example](./cache-extension.md).
