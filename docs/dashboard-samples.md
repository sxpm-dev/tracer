# Dashboard samples and recording storage

[Documentation index](./README.md) · [Dashboard package](../packages/dashboard/README.md)

## Try a loaded frontend recording

From the repository root, after `yarn install`:

```sh
yarn dashboard:sample
```

The command generates four synthetic recordings, reuses matching files on later
runs, and starts the default dashboard at `http://127.0.0.1:4178`. If the dashboard
has not been built, the launcher builds the library packages first. The Sessions
page lists the recordings immediately; the first visit to a session prepares its
paged query index. It can take time to index a million observations. Subsequent
queries reuse the index. The UI and API do not need to load the entire recording
into one browser array.

These are **synthetic models of plausible frontend workloads**, not recordings
from real production applications and not performance benchmarks for the library.
Titles and custom metadata label them as synthetic. They exercise the real saved
recording format and dashboard queries, without fabricating claims about measured
browser capabilities or production behavior.

| Scenario | Four subsystems | Workload and stress interval |
| --- | --- | --- |
| `editor` | editor, layout, renderer, collaboration | Drag a 240-node selection in an 18,000-node design; constraint resolution, text measurement, painting, and remote patches |
| `maps` | navigation, tiles, map-renderer, live-data | Pan a map with 64 visible tiles and 8,500 vehicles; a cold tile cache increases decode and label-placement work |
| `game` | input, physics, webgl, network | A 32-player arena with 2,400 entities; particle bursts and server reconciliation increase frame cost |
| `video` | timeline, decoder, effects, compositor | Scrub a 12-track 4K timeline; effect-cache invalidation delays frame delivery and preview composition |

Each scenario repeats steady, stress, and recovery phases. A ray represents one
frontend operation/frame with nested subsystem calls. Some stress windows include
recoverable error outcomes. Browser signals include FPS, timer lag, input delay,
JS heap size, resource duration, and transferred bytes. CPU samples represent
synthetic long tasks. Domain-specific extension channels include cache outcomes,
queue depth, and workload size; samples include a ray ID for explicit correlation.

The models describe work observable from one frontend realm. In particular, video
and GPU-related method names represent scheduling/delivery/composition activity;
they do not claim to measure worker internals, decoder hardware, or GPU execution.

### Size and commands

```sh
yarn dashboard:sample editor
yarn dashboard:sample maps --samples 2000000
yarn dashboard:sample all --generate-only
yarn dashboard:sample video --port 4180
```

Default: **1,000,000 observations per recording**, four recordings. `--samples`
counts trace events (calls and markers), browser samples, CPU samples, and custom
extension samples together. It is not a count of rays or JSONL lines. At the
one-million default each recording contains:

| Observation | Count |
| --- | ---: |
| Trace events | 987,737 |
| Browser samples | 10,398 |
| CPU samples | 132 |
| Custom samples | 1,733 |
| Total | 1,000,000 |

Use up to `--samples 2000000` per recording. Small counts down to 100 are accepted
for quick checks; they may stop before the stress phase and omit some signals.
The four default source recordings occupy about 610 MiB, plus derived indexes.
A larger observation count lengthens the scenario rather than allocating an
in-memory array of that size. Generation writes bounded buffers to disk.

The generators live under [`scripts/dashboard-samples/`](../scripts/dashboard-samples),
outside the dashboard package. Generated files are local and Git-ignored. Neither
the generators nor their data are included in the published dashboard archive.
The dashboard's existing tiny in-app examples are separate from these repo datasets.

## One storage rule

**Recordings live in `.recordings/` under the directory where you launch the
server.** They do not live inside the installed npm package, npx's cache, the UI
build, or a per-user hidden application directory.

| Launch | Default storage |
| --- | --- |
| Repo: `yarn dashboard` or `yarn start:dashboard` | `<repo>/.recordings/` |
| Repo: `yarn dashboard:sample` | Generates into and serves `<repo>/.recordings/` |
| Installed CLI from a consumer project | `<consumer project>/.recordings/` |
| Consumer-built UI via `--dashboard ./dist` | Same project `.recordings/`; the UI directory does not change storage |
| `startRecordingServer()` or `recordingsServer()` | `.recordings/` under the Node process's working directory |

The repository launchers explicitly run from the repo root, avoiding Yarn's
workspace-directory change. Directly running a package's workspace command uses
that package's working directory; prefer the root commands for repository work.
The CLI prints the absolute recordings directory at startup.

For the published package, the explicit npm invocation is:

```sh
# Run from the consumer project directory.
npx --package @sx/dashboard trace-dashboard
```

`npx sx/dashboard` is not the scoped npm package name. The intended package is
`@sx/dashboard`; until publication, use the local package archives described in
the [development guide](./development.md#local-package-archives).

### One optional override

```sh
yarn dashboard --recordings ./captures
yarn dashboard:sample editor --recordings ./captures
npx --package @sx/dashboard trace-dashboard --recordings ./captures
```

The CLI option is `--recordings`. Programmatic server and Vite integrations use
its equivalent `recordingsDirectory`. Relative paths resolve against the launch
directory; absolute paths work unchanged. There is no required config file,
environment variable, or per-block storage setting.

```ts
import { startRecordingServer } from '@sx/dashboard/server';

await startRecordingServer({
  dashboardDirectory: './dist', // Consumer UI with its own blocks.
  // recordingsDirectory: './captures', // Optional; defaults to .recordings.
});
```

For development, a consumer's Vite config can install `recordingsServer()` from
`@sx/dashboard/vite` with no storage options. Custom blocks read the same server's
recordings; they do not create their own recording directories. If the UI and
server run separately, point the UI's `serverUrl` at that server. The server's
launch directory still determines storage.

## Files, reuse, and cleanup

A recording uses `<sessionId>.jsonl` for payloads, `.meta.json` for session metadata,
and `.rays` for ray bookkeeping. The `.dashboard-index/` directory contains
rebuildable SQLite query caches. Export or back up source files together; derived
indexes are disposable while the server is stopped. Add `.recordings/` to a
consumer project's `.gitignore` as this repository does.

Sample IDs include the domain, generator version, and requested observation count,
for example `sample-editor-v1-1000000`. Matching complete recordings are reused
without changing their timestamps. Different counts produce separate recordings.
Normal captured sessions are never cleared or replaced by the sample command.

A completed sample is published only after its data files are written. The generator
uses a per-sample exclusive lock to prevent concurrent publication and refuses to
overwrite files whose saved size no longer matches, or a deleted session's tombstone. If interrupted, stop
other generators and remove only that sample's leftover `.tmp.*`/`.sample-lock`
files before retrying. If data was published but metadata was not, remove that
sample's orphan `.jsonl` and `.rays` files as well. Do not delete unrelated sessions.

Deleting a sample in the dashboard is respected: the sample command does not
silently resurrect it. To recreate it, stop the dashboard and deliberately remove
that sample ID's files, including its `.deleted` tombstone, then run the command
again. Alternatively, generate a different observation count. There is no automatic
retention policy or startup deletion.

## Verify the fixtures

```sh
yarn build
yarn test:dashboard-samples
yarn workspace @sx/dashboard test
```

Checks cover deterministic data, exact observation counts, valid parent timing,
four namespaces, stress signals, reuse without overwrites, and loading through
the real paged API. These validate the fixtures and storage integration; simulated
signals cannot establish real application performance or browser support.
