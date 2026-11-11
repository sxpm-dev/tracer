---
title: "Async Semantics"
description: "How @sx/tracer attributes markers after await."
---

# Async Semantics

Markers after `await` work when the async function is traced and awaited inside a
collect scope.

```ts
const load = trace(async function load() {
  await something();
  marker("done");
});

await trace.collect(() => load());
```

For detached async work, wrap the function with `trace`, await it from a traced
parent, or use `trace.step` for a named section.
