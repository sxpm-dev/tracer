---
title: "Getting Started"
description: "Install @sx/tracer and collect your first trace."
---

# Getting Started

Install the tracer package:

```bash
npm install @sx/tracer
# or
yarn add @sx/tracer
```

## Collect a trace

```ts
import { marker, trace } from "@sx/tracer";

const loadProfile = trace(async function loadProfile(id: string) {
  marker("fetch-start", { id });
  await Promise.resolve();
  marker("fetch-end", { ok: true });
  return { id, name: "Ada" };
});

const report = await trace.collect(() => loadProfile("u1"));

console.log(report.names);
```

Output:

```ts
["loadProfile", "loadProfile.fetch-start", "loadProfile.fetch-end"];
```

Wrapped functions are intentionally cheap outside `trace.collect`. Recording
happens only when you open a scope.

## Decorators

If you want to use `@Trace`, enable legacy decorators:

```jsonc
{
  "compilerOptions": {
    "experimentalDecorators": true
  }
}
```
