# Offline recording analytics

Purpose: reusable Python analytics for large JSONL trace recordings. Query totals, counts, durations, time windows, and trace trees without repeatedly parsing GB of JSON or returning entire logs to an assistant. Python 3.9+; standard library only.

The tool is standalone: it reads a recordings directory and writes nothing outside the paths you give it. Run it from the directory holding your recordings, or pass `--recordings PATH`. Replace `<session-id>` below with a session reported by `list`.

## Locate the script

The commands below assume you are in this tool directory and have a `recordings.py`
script available. From the repository root, use:

```sh
python3 packages/tracing/tools/recording-query/recordings.py --help
```

Pass the recordings directory as described by the command help. See the
[dashboard guide](../../DASHBOARD.md) for creating recordings and the
[documentation index](../../../../docs/README.md) for the rest of the pipeline.

## Workflow

```sh
# List available recording metadata.
python3 recordings.py list

# One-time streaming import; later commands reuse this index automatically.
python3 recordings.py index <session-id>

# SUM/count by namespace, or one total across all calls.
python3 recordings.py stats <session-id> --by namespace
python3 recordings.py stats <session-id>

# Sum durations and counts for matching functions.
python3 recordings.py stats <session-id> --name getIndicators --by method

# Top methods by self elapsed time, inclusive total, mean, maximum, or call count.
python3 recordings.py methods <session-id> --namespace editor-platform --sort total --limit 15

# Calls starting in [2000, 5000) ms, restricted to indicator-root trace trees.
python3 recordings.py stats <session-id> --start-ms 2000 --end-ms 5000 --root 'Editor Indications Orchestrator API.getIndicators' --by namespace

# Root calls only (root elapsed duration, not the sum of their descendants).
python3 recordings.py roots <session-id> --name getIndicators

# Entire trace trees grouped by their root method (includes descendants).
python3 recordings.py stats <session-id> --by root --sort count

# Find expensive individual calls and their ray IDs; then inspect one ray.
python3 recordings.py calls <session-id> --min-ms 40 --limit 10
python3 recordings.py trace <session-id> RAY_ID --limit 100

# Browser metrics, integrity checks, counts, long-frame blocking, source hash.
python3 recordings.py summary <session-id>
```

JSON goes to stdout; import progress goes to stderr. Redirect results to a report evidence file when relevant. `--recordings PATH` and `--cache PATH` are global options placed before the subcommand. Default cache: `.recording-query-cache/` (Git ignored, rebuildable). Source logs are unchanged.

## Ad hoc analytical SQL

`sql` supports read-only SELECT/CTE queries. SQLite authorization rejects writes, ATTACH, PRAGMA, and other non-read operations. Parameters are a JSON list or object. Output defaults to 100 rows; truncation is explicit. LIMIT caps returned output, not execution cost; use indexed filters and rollups for expensive datasets.

```sh
# Fast totals for a namespace from precomputed method_stats (no event scan).
python3 recordings.py sql <session-id> \
  'SELECT SUM(calls) calls, SUM(totalMs) inclusiveMs, SUM(selfMs) selfMs FROM method_stats JOIN methods USING(mid) WHERE namespace=?' \
  --params '["editor-platform"]'

# Timeline, per second. Markers excluded explicitly.
python3 recordings.py sql <session-id> \
  "SELECT CAST(at/1000 AS INTEGER) second, COUNT(*) calls, SUM(self) selfMs FROM events WHERE kind='call' GROUP BY second ORDER BY second"

# Exact p95 of a specific method, on demand. Slower than rollup queries.
python3 recordings.py sql <session-id> \
  "WITH ranked AS (SELECT duration, ROW_NUMBER() OVER (ORDER BY duration) n, COUNT(*) OVER () c FROM events JOIN methods USING(mid) WHERE kind='call' AND name=? AND duration IS NOT NULL) SELECT duration p95Ms FROM ranked WHERE n=CAST((c-1)*0.95 AS INTEGER)+1" \
  --params '["BuilderComponentsPrivateService.getComponentDataByComponentType"]'
```

### Schema

- `methods(mid, namespace, name)`: interned function identity.
- `rays(rid, ray, root_mid, root_count)`: trace identity; first observed root method. Multiple-root rays are flagged in summary, so root-group attribution can be qualified.
- `events(rid, eid, parent, mid, at, duration, self, error, kind)`: numeric times in recording-relative milliseconds. `eid` and `parent` are local to a ray. Markers are retained; normal analytical commands exclude them. Arguments/results are deliberately omitted from this index.
- `method_stats(mid, calls, completed, totalMs, selfMs, minMs, maxMs, errors, unfinished)`: small precomputed table for full-session sums; mean is `SUM(totalMs)/SUM(completed)`, not an average of averages.
- `root_stats(root_mid, ...)`: same aggregates for all calls in each root-method family, including descendants. Its inclusive total is **not** the root duration; use `roots` for root calls themselves.
- `samples(type, at, metric, value, data)`: browser, CPU, extension and other non-event records. `data` preserves the original record as JSON. SQLite JSON functions support custom sample analysis.
- `chunks(rid, offset, length)`: raw JSONL byte ranges for trace records; useful for future argument drill-down without scanning the full source.
- `info(key, value)`: source fingerprint, SHA-256, metadata, schema version, record-type counts and integrity data.

## Calculation rules

1. Inclusive duration is the recorded elapsed duration. Sums across nested calls overlap and are not CPU time.
2. Self/untraced elapsed = parent duration minus the **union of direct child call intervals**, clipped to the parent interval. Handles overlapping children and rays split over JSONL records. It still includes uninstrumented work, waits, and tracing overhead.
3. Time filters use call **start time**, `[start_ms, end_ms)`. Durations are not clipped to the query window.
4. Unfinished calls count as calls but have NULL duration; they are excluded from duration means, not treated as zero. Legitimate zero durations are retained.
5. Namespace/method/root statistics query raw full-mode calls. Light-mode aggregates are retained in `samples` but are not mixed with full call statistics; summary emits a warning for non-full modes.
6. FPS means average recorded samples. Event Timing is thresholded and is not INP. Long-frame script attribution can be truncated upstream.
7. Duplicate `(ray, event ID)` fails the import instead of silently double-counting. Missing parents, unfinished calls, multiple roots and out-of-range timestamps are surfaced in summary.
8. Index invalidation uses source and metadata size/mtime plus schema version. SHA-256 is saved during import. Use `index --force` when files may have been replaced with identical timestamps/sizes.

Import memory scales with distinct rays/methods and the largest individual record/ray, rather than total events. Index disk space scales with event count. Temporary builds replace the existing index only after success; incomplete recordings and files changing during import are rejected. No Chrome connection is used.

## Save a comparison

```sh
python3 recordings.py compare BEFORE_ID AFTER_ID \
  --scenario 'Mouse move over button + drag + resize + set background' \
  --before-label 'Platform attempt #2' \
  --after-label 'Editor attempt #1' \
  --changes 'Describe actual editor changes, known revision, and collector settings here'
```

Defaults to a new timestamped directory under `comparisons/` in the current directory, saving Markdown + JSON + method CSV. Explicit `--output PATH` is supported. Existing report directories are never overwritten. The report is evidence, not an automatic causal conclusion: review actions, code, and instrumentation differences before interpreting it. Reports require explicit scenario and before/after descriptions.

## Tests

```sh
python3 -m unittest discover -s . -v
```

Tests cover split rays, overlapping children, start-time filters, rollup totals, stale index rebuilding, duplicates, live-recording rejection, and preserving comparison identity/history.
