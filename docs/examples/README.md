# Examples

[Documentation index](../README.md)

| Example | Use it when |
| --- | --- |
| [Context across awaits and callbacks](./context-boundaries.md) | Compare local capture, explicit callback capture, and Node ALS propagation. |
| [Markers, samples and reusable collectors](./tracing-data.md) | Choose the correct data scope, correlate a sample with a ray, or configure consumer-owned lifecycle hooks. |
| [Dashboard extension recipes](./dashboard-recipes.md) | Add pages and columns, wrap core blocks, enrich the inspector, and compose features. |
| [Extra data per tracing ray](./ray-metadata.md) | Each operation needs its own request context, cache outcomes, or result metadata, including after `await`. |
| [Cache telemetry and custom dashboard](./cache-extension.md) | A consumer needs recording-wide samples and a custom dashboard block. |

Ray metadata belongs to one operation. Extension samples belong to a recording;
they are not automatically associated with a ray. Markers describe timed events
inside a traced call. These examples show the different scopes explicitly.
