# E2E execution comparison and anomaly detection

[Documentation index](./README.md) · [How tracing works](./how-tracing-works.md) · [Per-ray metadata](./examples/ray-metadata.md)

A green E2E test proves its assertions passed. It does not prove the application
used the same execution path as the previous run. The same screen can appear after
one cache lookup or twenty network requests, after one handler invocation or a
series of retries. Recording the instrumented execution adds evidence about **how
the result was produced**.

There are two useful applications:

- **E2E execution comparison:** compare a controlled scenario against an approved
  structural baseline to catch unexpected changes early in CI.
- **Execution anomaly detection:** look for unusual paths, counts, errors, and
  consumer signals across repeated scenarios or sampled runtime recordings.

The packages supply capture, recordings, reports, and dashboard extension points.
A structural snapshot comparator, baseline approval policy, CI gate, or automatic
anomaly detector is **consumer-owned functionality**, not a built-in feature.

## E2E can stay green while execution changes

Consider a checkout test that asserts a successful confirmation. Both executions
below satisfy that assertion:

```text
Approved baseline                 Candidate: E2E still passes
shell.checkout                    shell.checkout
  catalog.loadProduct               catalog.loadProduct
    cache.read                        cache.read
  cart.addItem                        api.fetchProduct
  payments.submit                     api.fetchProduct
                                    cart.addItem
                                    payments.submit
```

This illustrative candidate adds a fallback and a duplicate fetch. Even if its
elapsed time happens to be lower on a faster CI machine, the execution difference
is worth investigating. A deliberate change to cache policy may explain it; the
difference alone is not proof of a bug.

For deterministic scenarios, the normalized call structure often stays stable
across runs even when timings vary. Establish that stability by recording several
unchanged runs before treating a snapshot as an invariant.

### What “execution stack trace” means here

Compare the **recorded call structure**, not the literal text of `Error().stack`.
Stack inspection is an internal mechanism for recovering async ownership. The
recording exposes rays and events with names, namespaces, parent relationships,
statuses, and optional consumer data. It is not a complete native stack dump of
every JavaScript instruction or every uninstrumented function.

In full mode, `TraceEvent` includes `id`, `parent`, `ray`, `kind`, `name`,
`namespace`, `at`, and optional `duration`, `status`, `error`, and `data`.
The [runtime types](../packages/tracing/src/runtime.ts) define the format.
Light mode aggregates function statistics and cannot reconstruct the same call
tree. Use **full mode** for structural baselines and consistent async-context
capture settings for every compared run.

### Capture a comparable scenario

1. Instrument meaningful operations with stable names and namespaces. For a
   microfrontend application, use the [shared runtime](./shared-runtime.md) so
   participating modules contribute to the host-owned recording.
2. Define the scenario: input fixtures, feature flags, cache state, browser/runtime,
   authentication state, and the exact start/end boundary. Keep warm-cache and
   cold-cache scenarios separate.
3. Enable tracing before the application modules load. Start a full recording in
   the application before the E2E action, await application-specific completion,
   and release it afterward, including on test failure. The E2E runner must bridge
   into the application realm; importing tracing in the test process alone does
   not record the browser application.
4. Save the recording alongside the test result, source revision, instrumentation
   version, capture options, and scenario ID. Use a stable scenario ID in
   [ray metadata](./examples/ray-metadata.md); keep unique run IDs for provenance,
   not structural equality.
5. Record several unchanged runs. Identify legitimate variants and nondeterministic
   work before creating a reviewed baseline.
6. Compare a new run against the matching baseline and publish an explainable diff
   as a CI artifact. Keep ordinary E2E assertions as an independent check.

See [First recording](./getting-started.md) for capture APIs and
[recording sessions](../packages/recordings/README.md) for saving through the
transport. Use an explicit completion signal for the measured operation instead
of assuming a fixed sleep captured all its async work.

### Normalize structure, retain useful differences

A consumer comparator can build a canonical projection of each selected ray:

| Recorded information | Comparison policy |
| --- | --- |
| Event namespace, name and kind | Keep as the operation identity; a name alone can collide across subsystems |
| Event ID, parent ID, ray ID | Use IDs to rebuild relationships within the recording, then replace raw IDs with structural positions |
| Parent/child relationships and repeated calls | Keep; extra calls and changed ownership are useful differences |
| Child order | Keep when sequence is part of the contract; explicitly normalize only known independent siblings |
| `at`, `duration`, memory measurements | Exclude from structural equality; analyze separately as variable measurements |
| Status and selected marker data | Keep outcomes and stable semantic signals, such as cache hit/miss or retry reason |
| Arguments, error objects, metadata | Allowlist stable relevant fields; exclude volatile IDs, timestamps and machine-dependent stack text |
| Independent root rays | Match by scenario/operation and meaningful consumer keys; preserve multiplicity rather than relying on generated IDs |

For each ray, index events by ID, attach children to their recorded parents, and
serialize the chosen fields recursively using an unambiguous representation such
as JSON arrays. An absent parent field denotes a root. A parent ID that refers to no recorded
event is a capture-quality issue to investigate, not an edge to silently discard. Keep the readable projection alongside any hash:
a hash can detect inequality but cannot explain it.

Do not sort every event into a flat list. That loses parentage and can hide a
sequence regression. Where concurrent sibling order is intentionally irrelevant,
compare their canonical subtrees as a multiset, retaining duplicate counts. If
your capture cannot establish an ordering or causal relationship, do not invent
one during normalization.

Illustrative structural comparison output (not a built-in CLI format):

```text
scenario: checkout / warm-cache
E2E assertions: PASS
capture quality: ACCEPTED
structure: CHANGED
+ shell.checkout > catalog.loadProduct > api.fetchProduct: 0 → 2 calls
  investigate: expected cache-hit path now invokes network fallback
wall-clock duration: reported separately; not used for structural equality
```

### Use a baseline without making CI brittle

Start in report-only mode. Once repeated runs establish stable behavior, gate on
specific invariants: no duplicate submission, no fetch on the warm-cache path,
no unexpected error outcome, or an approved set of call-tree variants. Exact tree
equality is useful for tightly controlled scenarios; it is too strict for every
application interaction.

Classify results as **unchanged**, **changed**, or **inconclusive**. Missing
instrumentation, an incomplete recording, mismatched settings, or an unmatched
scenario must not count as an unchanged execution. A deliberate refactor can
change the tree without breaking behavior; review the diff and update the baseline
with the code change and its reason. Do not automatically replace the baseline
because a new run is green.

## Execution anomaly detector

Beyond one E2E snapshot, a consumer detector can compare repeated recordings for
the same operation and context. Useful signals include:

| Signal | Possible explanation to investigate |
| --- | --- |
| New call path or parent/child edge | Unexpected fallback, feature-flag drift, or changed routing |
| Increased calls per scenario | Duplicate listeners, repeated rendering, retry storms, or lost batching |
| Missing expected operation | Skipped validation or incomplete capture |
| More error outcomes despite successful UI | Errors recovered by a fallback and hidden by final-state assertions |
| Cache-hit metadata shifts to misses | Cache invalidation changes or a different input population |
| Duration distribution shifts with stable structure | Slower dependencies, contention, or environment changes |

These are hypotheses, not diagnoses. A new path can be intended, and a frequent
path can still be incorrect. Compare like-for-like groups by scenario, workload
size, build, flags, cache state, and environment. Use per-operation counts or rates
when recording lengths differ. For timing thresholds, retain repeated observations
and account for normal variability; do not infer a regression from one duration.

A practical consumer pipeline is:

```text
Capture representative scenarios
  → check capture quality and group comparable runs
  → derive normalized paths, counts, outcomes and custom signals
  → compare with reviewed invariants or an observed baseline distribution
  → produce an anomaly with evidence, context and severity
  → investigate against matching source
  → fix or approve the change, then record again
```

Use [collectors and samples](./examples/tracing-data.md) for domain signals and
[dashboard pages, columns and blocks](./examples/dashboard-recipes.md) to surface
consumer detector results. For example, a custom page can show the scenario,
baseline/candidate session IDs, changed paths, and cache outcomes. A detector must
perform its own comparison; extending the UI does not create detection logic.
Existing [performance reports](../packages/tracing/PERFORMANCE_REPORTS.md) help
compare aggregate measurements but are not an exact call-tree snapshot gate.
[Offline queries](../packages/tracing/tools/recording-query/README.md) can supply
recording evidence for a consumer analysis pipeline.

## Confidence and limits

- A match means the selected recorded projection matched. It does not prove
  identical inputs, side effects, correctness, or complete execution coverage.
- Uninstrumented code is invisible. Unsupported async boundaries can lose parent
  links; use [context-boundary examples](./examples/context-boundaries.md) to
  understand the capture limits before interpreting a new root as an anomaly.
- Instrumentation affects execution cost and may affect scheduling. Exercise
  correctness independently and keep capture settings consistent.
- Concurrent operations, random inputs, background tasks, and retries can produce
  valid variants. Document narrow exclusions rather than hiding all differences.
- Separate realms and backend services do not automatically form one recording.
  Use explicit correlation and retain their separate provenance.
- Long full recordings have a cost. Prefer bounded scenarios and verify capture
  completion; absence of an event is not enough to distinguish skipped work from
  missing evidence.

AI can help explain a structural diff when supplied with both recordings, the
normalization policy, and matching source revisions. Ask it to separate observed
changes from possible causes, then verify the proposed fix with another run. See
[the AI-assisted workflow](./ai-runtime-workflow.md).
