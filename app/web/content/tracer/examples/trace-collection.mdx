---
title: "Example: Trace Collection"
description: "Collect a trace with nested calls and inline markers."
---

# Example: Trace Collection

```ts
import { marker, trace } from "@sx/tracer";

const readUser = trace(async function readUser(id: string) {
  marker("query-start", { id });
  await Promise.resolve();
  marker("query-end", { found: true });
  return { id, name: "Ada" };
});

const buildProfile = trace(async function buildProfile(id: string) {
  const user = await readUser(id);
  marker("profile-ready");
  return { user, permissions: ["read"] };
});

const report = await trace.collect(() => buildProfile("u1"));

console.log(report.names);
```

Output:

```ts
[
  "buildProfile",
  "readUser",
  "readUser.query-start",
  "readUser.query-end",
  "buildProfile.profile-ready",
]
```

Use `report.events` for richer event data when you need ids, parents, timing,
captured arguments, captured results, or marker payloads.
