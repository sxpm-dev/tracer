---
title: "@sx/tracer API"
description: "API reference for trace, marker, Trace, collect, step, and subscribe."
---

# `@sx/tracer`

`@sx/tracer` records call events and marker events inside explicit trace scopes.
Outside a scope, traced functions call through directly.

## `trace(fn, options?)`

Wraps a function so calls can be recorded inside `trace.collect`.

```ts
import { trace } from "@sx/tracer";

const load = trace(async function load(id: string) {
  return fetch(`/api/${id}`);
});
```

Options:

| Option | Purpose |
| --- | --- |
| `name` | Override the event name. |
| `captureArgs` | Capture arguments, or map/redact them with a function. |
| `captureResult` | Capture returned values, or map/redact them with a function. |
| `captureError` | Capture thrown or rejected errors, or map/redact them with a function. |
| `captureTiming` | Record duration for a call. |
| `captureStack` | Attach a lazy stack getter to the call event. |

## `marker(name, data?)`

Records an inline marker under the current traced frame.

```ts
const compute = trace(function compute(input: number[]) {
  marker("start", { size: input.length });
  const total = input.reduce((sum, item) => sum + item, 0);
  marker("done", { total });
  return total;
});
```

The resulting names are `compute`, `compute.start`, and `compute.done`.

## `Trace`

Decorator form for methods or classes.

```ts
import { Trace } from "@sx/tracer";

@Trace
class UserService {
  async findUser(id: string) {
    return db.users.findOne(id);
  }
}
```

Enable `experimentalDecorators` in `tsconfig.json` before using decorators.

## `trace.collect(fn)`

Opens a recording scope, runs `fn`, and returns the captured result.

```ts
const { ray, result, names, events } = await trace.collect(() =>
  service.findUser("u1"),
);
```

`names` is a compact ordered list. `events` contains synthesized event objects
with ids, parent ids, timestamps, and captured extras.

## `trace.step(name, fn)`

Runs a named child section inside the active trace.

```ts
await trace.step("validate", async () => {
  await validate();
  marker("ok");
});
```

Markers inside the step are attributed to the step name.

## `trace.subscribe(callback)`

Subscribes to every recorded event and returns an unsubscribe function.

```ts
const unsubscribe = trace.subscribe((event) => {
  console.log(event.ray, event.name, event.kind);
});
```

This is useful for forwarding sampled traces to logs or telemetry systems.
