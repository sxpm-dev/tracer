# Performance reports

The dashboard can turn a saved recording into a session report, or compare
several saved recordings. Open a saved session and choose **Create performance
report**, or select recordings on the sessions screen and choose **Compare in
report**. Generation starts immediately on a dedicated report page; the oldest
selected recording is the baseline. The result opens with a **Download HTML** action. The
HTML includes its evidence bundle and works offline, including scenario tabs,
ranking controls, theme switching, and print/PDF. The dashboard requires no
metadata entry or authored narrative to generate a report.

## Regenerate with the CLI

Run the recording server against the same saved-recording directory, then run:

```sh
yarn trace-dashboard --recordings ./local-traces --port 4178
yarn trace-performance-report \
  --config report.config.json \
  --output report.html \
  --evidence report.evidence.json \
  --server http://127.0.0.1:4178
```

An agent can write or update the versioned JSON configuration to supply
scenario descriptions, checkpoint metadata, namespace names, section selection,
and authored analysis. The HTML is rendered by the same `buildPerformanceReport` and
`renderPerformanceReport` functions that the dashboard preview uses. The
`--evidence` file contains the typed, serializable calculated report data and
the original configuration. It can be given to another analyst or agent, which
can later add authored analysis to the configuration and regenerate the report.
The server streams preparation progress and reuses the persistent session index;
the HTML itself needs no server or external assets. The first report after this
feature is installed rebuilds an older index once to add compact browser and
blocking samples. Recordings are never rewritten.

See [the six-recording example](./examples/performance-report.config.json).
It contains assignments and names only, and no conclusions. For a single
session, use one scenario with one checkpoint whose `id` is also the
`baselineCheckpointId`.

## Configuration version 1

```json
{
  "version": 1,
  "title": "Optional title",
  "scenarios": [
    {
      "id": "scenario-1",
      "name": "Optional human-readable scenario name",
      "description": "Optional behavior description",
      "steps": "Optional reproduction steps",
      "baselineCheckpointId": "before",
      "checkpoints": [
        {
          "id": "before",
          "name": "Baseline",
          "description": "Optional checkpoint description",
          "build": "Optional build or commit reference",
          "notes": "Optional notes"
        }
      ],
      "sessions": { "before": "session-id" }
    }
  ],
  "namespaceNames": { "responsive-editor": "Editor" },
  "selectedNamespaces": ["responsive-editor", "editor-platform"],
  "sections": [
    "browser",
    "namespaces",
    "functions",
    "distributions",
    "cache",
    "quality"
  ],
  "analysis": {
    "conclusions": ["Authored interpretation"],
    "implementedChanges": ["Verified implementation change"],
    "remainingExpensiveFlows": ["Authored investigation finding"],
    "furtherInvestigation": ["Next experiment"]
  }
}
```

The dashboard automatically creates a minimal configuration from selected
recordings. For scripted or agent-created reports, the only required fields are
`version`, nonempty `scenarios`, each scenario's
`id`, `name`, ordered nonempty `checkpoints`, explicit
`baselineCheckpointId`, and `sessions` mapping. A checkpoint without an
assignment appears as missing. A session ID that no longer exists also appears
as missing; other preparation failures stop generation with an actionable
error. Omit `selectedNamespaces` to show all recorded namespaces. Omit
`sections` to show every calculated section. Each analysis array may be
omitted; the export then omits that authored section. Each string is treated as
plain text and escaped in HTML.

## Calculations and scope

- Function identity is namespace plus method name. A root call has no recorded
  parent. It is not necessarily a user action. Root mode uses only root calls
  and their own durations. Root tree volume counts traced calls descended from
  a given root function; it does not count computation bodies.
- Inclusive duration includes child work. It is useful for ranking a function,
  but sums of inclusive durations are not execution time. Recorded self time
  for each call is its nonnegative duration minus the union of direct-child
  call intervals clipped to the parent interval. This avoids subtracting
  overlapping children twice. It remains elapsed trace time, not CPU use;
  async waits and overlapping spans can make namespace totals exceed the
  recording duration.
- Calls/s and root calls/s divide their respective counts by recording
  seconds. Self ms/s divides namespace recorded self milliseconds by recording
  seconds. **Self share** divides namespace self time by all recorded self
  time. **Recording %** divides namespace self milliseconds by recording
  milliseconds. These denominators are deliberately separate.
- Function call-share bars divide by all calls or all root calls in that
  recording, according to the selected call scope. Choosing a namespace does
  not change that denominator. Ranking filters the source functions before
  choosing the top eight. Across checkpoints, it ranks the same function
  identities by the largest observed value and shows “Not observed” where an
  identity is absent.
- Percentage change is `(checkpoint − baseline) ÷ baseline × 100`, shown
  separately for raw totals and per-second rates. A zero or unavailable
  baseline has no percentage change. A missing measurement is never treated
  as zero.
- Duration buckets are `[0,1)`, `[1,4)`, `[4,16.67)`, `[16.67,50)`,
  `[50,100)`, `[100,500)`, and `[500,∞)` milliseconds. Browser p50 and p95
  use sorted samples at index `floor((n−1) × percentile)`, matching the
  reference extraction. Browser samples at timestamp zero are excluded because
  the collector clamps pre-origin timestamps to zero. Event Timing is
  thresholded and its percentiles are **not INP**.
- A cache path pairs `.cache-hit` and `.cache-miss` marker events with the
  same namespace and base method identity. Its hit rate is `hits ÷ (hits +
  misses)` only when both marker types were observed. A path with one marker
  type has counts but an unavailable rate because instrumentation coverage
  cannot be established. Identity-cache and application-specific markers are
  not combined with response-cache markers.

Browser-only recordings provide browser samples and blocking when captured,
but no function or root data. Light recordings provide aggregate call and
error totals and namespace call rates, but no parent links, root-only metrics,
self time, duration distributions, or cache marker outcomes. Missing browser
channels and dropped samples are shown as coverage notes. Capture mode and
instrumentation differences can change measurement scope even when a
percentage is calculable; the report does not claim a causal effect. The
dashboard index and report include only recorded measurements and do not infer
duplicate arguments, cache invalidation causes, or actual computation-body
counts.

## Authored narrative

The four arrays under `analysis` are the portable narrative schema. An analyst
or another agent can use the evidence JSON and source recording identifiers to
write them. Each claim should cite the observed measurement and checkpoint in
plain language. The generator does not produce causal conclusions, infer
implemented optimizations, or import prose from the example report. Keep
factual measurements in the calculated evidence and interpretation in these
authored arrays.

## Validation against the reference recordings

The six full-trace recordings in the example configuration were regenerated
from the indexed recordings and compared with
`docs/performance/independent-review-2026-09-26/final-handoff/session-metrics.json`.
For each recording, recording duration, all calls, root calls, recorded self
milliseconds, errors, mean sampled FPS, blocking sample count and duration,
and cache hit/miss counts matched the reference values. The automatic report
also includes all available browser channels; it does not apply the reference
report's hand-picked browser filters or reuse its authored conclusions.
