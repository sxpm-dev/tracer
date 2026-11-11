# Consumer extension validation

Contract: the core captures generic tracing data and serves a usable default dashboard. Consumers own custom schemas, collectors, analytics, and UI extensions. The imported implementation is the baseline.

Reviewed paths: tracing collector lifecycle and sample publication; recording stream deduplication and final tail upload; server JSONL parsing and paged channel queries; dashboard overview blocks, columns, replacements, pages, shared context and offline export projections.

Fix: removed the special treatment of the consumer page ID `caches` from browser-mode navigation and redirection. Two regression assertions failed before the fix and pass after it. Only core function/frame pages remain unavailable in browser mode. Export progress now says extension data rather than assuming cache analytics.

Validation added:
- Two consumer channels rendered alongside the default dashboard timeline.
- Consumer cache page usable in browser mode without forced navigation.
- Two registered collectors in full and light sessions; onStart, onStop, and decorated samples survive upload, JSONL loading and channel-specific paged reads exactly once.
- Installed npm artifacts expose the collector API and preserve custom channel payloads through the CLI server.

Existing boundaries remain explicit: ray metadata is full-mode, samples are full/light-mode, consumer code validates custom payloads, and arbitrary top-level decorate fields are local projections. Saved dashboard summaries require paged sample loading; absent raw arrays do not mean zero observations. Consumers compose one extension object and decide visibility and schema version handling.

Verification: 195 workspace tests passed, workspace typecheck passed, dashboard build passed, and the isolated npm consumer check passed for custom collector data as well as UI assets and ESM/CommonJS exports.
