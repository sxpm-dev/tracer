---
title: "Example: Telemetry Forwarder"
description: "Forward trace events to a logging or observability sink."
---

# Example: Telemetry Forwarder

```ts
import { trace } from "@sx/tracer";

const unsubscribe = trace.subscribe((event) => {
  console.log(
    JSON.stringify({
      ray: event.ray,
      id: event.id,
      parent: event.parent,
      name: event.name,
      kind: event.kind,
      status: event.status,
      duration: event.duration,
      data: event.data,
    }),
  );
});

try {
  await trace.collect(() => runWorkflow());
} finally {
  unsubscribe();
}
```

Subscribers fire for recorded events from active trace scopes. Keep payloads
small, and use capture options to redact arguments, results, and errors before
they leave the process.
