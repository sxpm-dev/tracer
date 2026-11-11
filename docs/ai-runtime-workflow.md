# AI-assisted runtime analysis and optimization

[Documentation index](./README.md) · [First recording](./getting-started.md)

The workflow is: instrument → record → give AI runtime evidence and source → ask
how the code behaved → map the evidence to code → optimize → record again → compare.
The purpose is to test explanations against observed execution instead of asking
for performance changes based only on how the code looks.

There is no automatic AI upload or source-mapping service in these packages.
Use an assistant or coding agent with access to the artifacts you choose to share.

## 1. Instrument the questions you want answered

Start at meaningful operations: loading a view, recalculating a model, handling an
input, or committing an update. Use stable namespaces and function names that can
be located in source. Do not embed request IDs in function names; put them in ray
metadata so aggregation still groups equivalent calls.

| Question | Useful evidence |
| --- | --- |
| Why did this helper run repeatedly? | Full-mode parent links, names, call counts and selected rays |
| Did a cache eliminate work? | Cache-hit/miss markers, cache namespace, per-ray context |
| What happened after a state change? | Named operation, relevant version/phase metadata, timed markers |
| Was an optimization effective across a long workload? | Comparable light-mode aggregates and time windows |
| Did the page block during the interaction? | Browser-signal data plus aligned traced activity; correlation alone does not establish cause |

[Ray metadata](./examples/ray-metadata.md), [markers and collectors](./examples/tracing-data.md),
and [consumer dashboards](./examples/dashboard-recipes.md) supply application-specific
context. Record only the fields necessary for the analysis. Avoid credentials,
personal data, full cache contents, or unbounded payloads.

## 2. Capture a baseline with an identifiable source revision

Write down the source commit/build, scenario steps, inputs or fixture version,
browser/runtime, capture mode/options, and whether caches were warm or cold.
These details are a handoff note; the library does not automatically determine all
of them. Keep the original recording available even if the first analysis uses a
compact report.

Use full mode for call-tree and per-ray questions. Light mode cannot answer exact
parent/child questions that it did not record. Browser-only mode cannot show
function calls. Record enough detail for the question without assuming more data
always means a better answer.

## 3. Give the AI a small, navigable evidence bundle

| Artifact | Why it matters |
| --- | --- |
| Matching source commit or checkout | Connects observed names to the code that actually ran |
| Scenario note | Defines the expected behavior and reproduction steps |
| Recording JSON/JSONL or access to the saved session | Preserves captured events and custom payloads |
| Report evidence JSON or query summaries | Lets the AI start with bounded statistics rather than a huge raw file |
| Instrumentation-name mapping, if needed | Disambiguates wrappers, aliases, generated code, and namespaces |
| Hypothesis or concrete question | Keeps analysis focused on behavior you can verify |

The [performance report CLI](../packages/tracing/PERFORMANCE_REPORTS.md#regenerate-with-the-cli)
can write structured evidence with `--evidence`. The
[offline query tool](../packages/tracing/tools/recording-query/README.md) supports
incremental analysis of local JSONL data. Let the assistant query relevant
functions, rays, and time windows instead of putting gigabytes into a prompt.

Standalone dashboard HTML contains summaries and optional consumer projections;
it omits raw frames and ray metadata. It is useful for review but is not a
replacement for the complete recording when investigating individual calls.

## 4. Ask about the code's observed behavior

Example prompt, with filenames replaced by the artifacts you actually provide:

> Analyze the attached baseline recording using the source at commit `<sha>`.
> The scenario is opening the product panel once with a cold cache.
> Explain why `catalog.load` ran repeatedly. Start with call counts and parent
> paths, then inspect representative rays and `cache.outcome` metadata.
> Distinguish observations from hypotheses. Cite session/ray/event identifiers
> or query filters for each observation and source files/functions for each code
> explanation. Do not infer that missing events mean the code never ran.

Good answers should identify a pattern, show the evidence supporting it, and point
to the relevant source. For example, repeated calls *may* be caused by a loop,
subscription, retry, or rendering path. The recording identifies observed calls;
source inspection and a controlled rerun distinguish those explanations.

## 5. Build an explicit trace-to-source map

Ask the assistant to map every relevant observed function, including ambiguous
ones, rather than claiming complete correspondence without evidence:

| Recorded identity | Source mapping to establish | Evidence to retain |
| --- | --- | --- |
| Namespace + instrumented name | Wrapper registration, class method, or function at the recorded revision | File/function and verified line if available |
| Ray and parent/event IDs | The observed call path through that operation | Selected ray and event identifiers |
| Metadata owner/channel | Producer schema and code writing the data | Schema version and producer location |
| Aggregate statistic | Query/filter scope and capture mode | Counts, units, time interval, and exclusions |

The AI can aim for complete mapping of the **relevant observed instrumented set**.
That is different from proving what every line of the application did. Explicit
labels can differ from source symbol names; anonymous functions, duplicate names,
changed builds, async attribution gaps and uninstrumented dependencies leave
uncertainty. The runtime's internal `Error.stack` slot lookup is not a general
source-map resolver. Supply source maps separately when useful; this workflow
does not automatically resolve them.

Ask it to list unmapped identities and additional instrumentation needed to answer
the question. This makes the next recording more useful without pretending the
first one contains all possible evidence.

## 6. Ask for a targeted optimization

> Based on the mapped evidence, propose the smallest change that reduces the
> repeated work without changing results. State the predicted change in call
> counts or duration, the code path it affects, and the tradeoffs. Implement
> correctness tests, including cache invalidation or error behavior where relevant.
> Keep the instrumentation comparable so we can test the prediction afterward.

Optimize the measured cause. A lower call count is not a success if it skips
required work. Caching may improve elapsed time while increasing memory or
introducing stale results. Keep correctness and performance as separate checks.

## 7. Record the candidate and compare

Repeat the same scenario against the changed source, with the same capture mode,
options, fixtures, environment, and cache conditions. Keep baseline and candidate
session IDs and commit IDs. Repeat each condition to expose variability; alternate
run order when cache or machine state could bias the comparison.

Use the dashboard's **Compare in report**, or the report CLI with an explicit
baseline/candidate configuration. Examine:

- The predicted metric: call counts, rates, elapsed durations, or custom cache outcomes.
- Correctness: expected outputs, errors, and tests.
- Regressions: shifted work, browser blocking, memory observations, or additional calls elsewhere.
- Comparability: workload size, recording duration, missing/unsupported signals, and dropped data.

Example follow-up prompt:

> Compare baseline `<session-a>/<commit-a>` with candidate `<session-b>/<commit-b>`.
> Did the predicted reduction in `catalog.load` calls occur for the same workload?
> Show absolute values and percentage changes, with units and filters. Explain
> whether elapsed-time changes exceed the variation across repeated recordings.
> Identify regressions and missing evidence. Do not call reduced instrumentation
> an optimization or sum overlapping inclusive durations as total wall-clock time.

Report raw totals and rates when recording lengths differ. With a zero baseline,
a percentage reduction is undefined; report the absolute change. See
[report formulas and limits](../packages/tracing/PERFORMANCE_REPORTS.md).

## Recorded evidence versus AI-driven execution

A supplied recording preserves one chosen execution. It can capture an interaction
in an environment an agent cannot conveniently reproduce, and multiple analysts
can inspect the same data without replaying it. It also lets the consumer expose
intentional domain signals such as cache outcomes.

Its limits are equally important: it is a snapshot, instrumentation affects cost,
and unobserved code or state cannot be recovered by asking a more confident
question. A recording alone does not prove causality, correctness, or future
performance.

An agent that runs the application can explore new scenarios, inspect visible
behavior, add instrumentation, and validate a fix. But it needs the right setup,
data, interactions and environment. A passing run against different conditions
may not explain the original problem. Running an app alone also does not provide
all the structured tracing data unless it is instrumented or profiled.

The strongest loop combines both: capture a representative baseline, use AI to
connect evidence to code and propose a falsifiable change, then run the application
again to measure the result. The recorder makes the evidence available; the
analysis still needs verification.
