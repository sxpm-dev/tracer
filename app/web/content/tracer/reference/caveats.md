---
title: "Caveats"
description: "Known limits for @sx/tracer."
---

# Caveats

- `@sx/tracer` is not OpenTelemetry.
- It records in-process events, not distributed spans.
- Detached async work needs explicit wrapping or `trace.step`.
- Stack capture and timing are opt-in because they add cost.

Use OpenTelemetry when you need cross-service propagation, exporters, sampling
strategy, and ecosystem integrations.
