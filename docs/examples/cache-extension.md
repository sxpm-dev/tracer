# Example: consumer cache telemetry and UI

[Documentation index](../README.md) · [Extension contracts](../../packages/tracing/EXTENDING.md)

This example keeps application data and UI in the consumer. It uses the published
entry points only. The producer runs in the instrumented application; the React
component runs in a separate consumer dashboard. They share a channel name and
payload schema, not module state.

## Application: emit bounded cache outcomes

Load the application with `?install-tracing` before these modules initialize.
Start and release a full or light session as in the
[first-recording guide](../getting-started.md).

```ts
import { addTraceExtensionSample, registerTraceCollector } from '@sx/recordings';

let hits = 0;
let misses = 0;

export function noteCacheResult(hit: boolean) {
  if (hit) hits += 1;
  else misses += 1;
}

export const unregisterCache = registerTraceCollector({
  name: 'shop.cache',
  onStart: () => { hits = 0; misses = 0; },
  onStop: () => addTraceExtensionSample('shop.cache', {
    version: 1,
    hits,
    misses,
  }),
});
```

Call `noteCacheResult(true)` on a hit and `noteCacheResult(false)` on a miss.
Only the closing totals are emitted, so sample count is bounded to one per
recording. Dispose with `unregisterCache()` when unloading the integration.
Do not include cache keys or values unless you explicitly intend to record them.
For rates over time, emit bounded interval deltas instead and version that schema.

## Consumer dashboard: read complete or paged data

Install the dashboard's React peers. This component validates unknown data and
works with both imported complete recordings and saved-session summaries. It
shows unavailable data separately from zero observed hits.

```tsx
import { useEffect, useState } from 'react';
import { DashboardApp, useDashboard } from '@sx/dashboard';
import '@sx/dashboard/style.css';

type CacheTotals = { version: 1; hits: number; misses: number };

function isTotals(value: unknown): value is CacheTotals {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<CacheTotals>;
  return data.version === 1 &&
    typeof data.hits === 'number' && Number.isFinite(data.hits) && data.hits >= 0 &&
    typeof data.misses === 'number' && Number.isFinite(data.misses) && data.misses >= 0;
}

function CacheOverview() {
  const { recording, dataScope, sessionClient, traceDataExcluded } = useDashboard();
  const [label, setLabel] = useState('Loading cache data');

  useEffect(() => {
    const controller = new AbortController();
    setLabel('Loading cache data');
    async function load() {
      const samples: unknown[] = [];
      if (dataScope === 'complete') {
        for (const sample of recording.extensionSamples ?? []) {
          if (sample.channel === 'shop.cache') samples.push(sample.data);
        }
      } else if (sessionClient && !traceDataExcluded) {
        let offset = 0;
        for (;;) {
          const page = await sessionClient.samples(
            recording.sessionId, 'shop.cache', offset, controller.signal,
          );
          samples.push(...page.items.map(sample => sample.data));
          offset += page.items.length;
          if (offset >= page.total || page.items.length === 0) break;
        }
      } else {
        if (!controller.signal.aborted) setLabel('Cache data unavailable');
        return;
      }
      const totals = samples.filter(isTotals);
      const hits = totals.reduce((sum, item) => sum + item.hits, 0);
      const misses = totals.reduce((sum, item) => sum + item.misses, 0);
      if (!controller.signal.aborted) {
        setLabel(totals.length ? `${hits} hits / ${misses} misses` : 'No compatible cache samples');
      }
    }
    void load().catch(error => {
      if (!controller.signal.aborted) setLabel(`Cache data failed: ${String(error)}`);
    });
    return () => controller.abort();
  }, [recording, dataScope, sessionClient, traceDataExcluded]);

  return <section className="cd-card"><h2>Cache</h2><p>{label}</p></section>;
}

const extensions = {
  overviewBlocks: [{ id: 'shop.cache', component: CacheOverview }],
};

export function App() {
  return <DashboardApp extensions={extensions} />;
}
```

The default dashboard remains present. This example assumes the custom dashboard
and recording API share an origin; otherwise pass `serverUrl` to `DashboardApp`.
Build the consumer application, then serve its output:

```sh
npx trace-dashboard --dashboard ./dist --recordings ./local-traces
```

Do not accumulate unbounded samples in a real extension: this example's producer
emits one closing sample. For large/high-rate channels, aggregate each page
incrementally or expose a consumer-owned projection endpoint.

## Offline HTML and capture modes

The example deliberately reports unavailable data in a summary-only offline
snapshot. To support offline cache totals, supply `DashboardApp.exportData` and
restore that projection with `readStandaloneSnapshot()?.extensions`; see
[standalone export data](../../packages/tracing/EXTENDING.md#standalone-export-data).
Browser-only captures do not emit extension samples. A consumer can conditionally
omit this block or display its unavailable state; the core does not decide cache
semantics or hide consumer pages by name.
