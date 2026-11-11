# Examples

[Documentation index](../README.md)

| Example | Use it when |
| --- | --- |
| [Extra data per tracing ray](./ray-metadata.md) | Each operation needs its own request context, cache outcomes, or result metadata, including after `await`. |
| [Cache telemetry and custom dashboard](./cache-extension.md) | A consumer needs recording-wide samples and a custom dashboard block. |

Ray metadata belongs to one operation. Extension samples belong to a recording;
they are not automatically associated with a ray. Markers describe timed events
inside a traced call. These examples show the different scopes explicitly.
