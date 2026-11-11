# Dashboard extension recipes

[Examples](./README.md) · [Complete cache pipeline](./cache-extension.md) · [Extension API](../../packages/tracing/EXTENDING.md)

Import UI from `@sx/dashboard`, its stylesheet from `@sx/dashboard/style.css`, and
install the declared React peers in the consumer. Data-only clients can use
`@sx/dashboard/data` without React. These recipes extend the default application;
they do not require changes to its recorder or server.

## 1. Add a page, a sortable column, and a wrapped block

This is a complete consumer React component:

```tsx
import {
  DashboardApp, useDashboard, type CoreDashboardExtensions,
} from '@sx/dashboard';
import '@sx/dashboard/style.css';

function Diagnostics() {
  const { analysis, recording, navigate } = useDashboard();
  return <section className="cd-card">
    <h2>Diagnostics for {recording.title ?? recording.sessionId}</h2>
    <p>{analysis.errors} recorded errors</p>
    <button onClick={() => navigate('overview')}>Back to overview</button>
  </section>;
}

const extensions: CoreDashboardExtensions = {
  additionalPages: [{
    id: 'shop.diagnostics', label: 'Diagnostics', subtitle: 'Consumer diagnostics',
    component: Diagnostics,
  }],
  functionColumns: [{
    id: 'shop.error-percent', label: 'Errors %',
    render: item => `${(100 * item.errors / Math.max(1, item.calls)).toFixed(1)}%`,
    sortValue: item => item.errors / Math.max(1, item.calls),
  }],
  blocks: {
    'overview.metrics': ({ children }) => <>
      <p>Statistics describe the captured workload.</p>
      {children}
    </>,
  },
};

export function App() {
  return <DashboardApp extensions={extensions} />;
}
```

The column uses core function summaries, so it does not load raw calls. A custom
cache-hit column should consume a consumer-built aggregate keyed by both function
namespace and name, using `functionKey(namespace, name)`. Do not fetch one complete
recording per row. Server-filtered views require aggregates matching the active
filters; observe `onRouteChange` for consumer-owned projections.

## 2. Enrich the selected frame inspector with ray metadata

This component is intended as a `frames.inspector` replacement. It renders
`children` to preserve the default inspector and uses a cancellable paged request
for saved sessions. For complete local recordings it reads the ray directly.

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { useDashboard } from '@sx/dashboard';

export function RequestInspector({ children }: { children: ReactNode }) {
  const { recording, selectedFrame, selectedRay, dataScope, sessionClient } = useDashboard();
  const ray = selectedFrame?.ray ?? selectedRay;
  const [requestId, setRequestId] = useState('Select a ray');

  useEffect(() => {
    const controller = new AbortController();
    setRequestId(ray ? 'Loading request metadata' : 'Select a ray');
    if (!ray) return () => controller.abort();
    async function load() {
      const metadata = dataScope === 'complete'
        ? recording.traces.find(item => item.ray === ray)?.metadata
        : (await sessionClient?.frames(recording.sessionId, { ray }, controller.signal))?.metadata;
      const raw = metadata?.['shop.request'];
      const data = raw && typeof raw === 'object'
        ? raw as { version?: unknown; requestId?: unknown } : undefined;
      const value = data?.version === 1 && typeof data.requestId === 'string'
        ? data.requestId : 'No compatible request metadata';
      if (!controller.signal.aborted) setRequestId(value);
    }
    void load().catch(error => {
      if (!controller.signal.aborted) setRequestId(`Could not load metadata: ${String(error)}`);
    });
    return () => controller.abort();
  }, [recording, ray, dataScope, sessionClient]);

  return <>{children}<section className="cd-card">
    <h3>Consumer request</h3><p>{requestId}</p>
  </section></>;
}
```

Register it in your consumer: `blocks: { 'frames.inspector': RequestInspector }`.
The matching producer is the [per-ray request example](./ray-metadata.md).
Offline summary exports omit raw frames/metadata, so an inspector is not an
alternative to supplying a compact offline projection.

## 3. Compose features without silently overriding each other

Consumers own composition. Keep array contributions additive and decide conflicting
block/page replacements explicitly. This fragment combines two independently
created configurations:

```ts
import type { CoreDashboardExtensions } from '@sx/dashboard';

export function combine(
  first: CoreDashboardExtensions,
  second: CoreDashboardExtensions,
): CoreDashboardExtensions {
  return {
    additionalPages: [...(first.additionalPages ?? []), ...(second.additionalPages ?? [])],
    overviewBlocks: [...(first.overviewBlocks ?? []), ...(second.overviewBlocks ?? [])],
    functionColumns: [...(first.functionColumns ?? []), ...(second.functionColumns ?? [])],
    // Deliberately not merging blocks/pages/renderers: resolve those in the host.
  };
}
```

Use consumer-prefixed IDs. Duplicate page, overview-block and function-column IDs
are rejected by the core. This function handles the three listed arrays only;
it is not a general merge of all extension fields.

## 4. Keep custom data in offline HTML

The `exportData(recording, summary, signal)` callback supplies a JSON-serializable
projection for *every* custom page, not only the currently visible one. For saved
sessions fetch one bounded consumer projection; for complete local imports derive
from that recording. Restore it with `readStandaloneSnapshot()?.extensions` and
validate its version before rendering. Do not request a live server when opening
an offline report. See the [offline projection contract](../../packages/tracing/EXTENDING.md#standalone-export-data).

## Run your consumer build

```sh
npx trace-dashboard --dashboard ./dist --recordings ./local-traces
```

This assumes the consumer build produces `dist/index.html`. If the application is
hosted elsewhere, pass `serverUrl` to `DashboardApp`. The core still supplies its
normal UI where no extension overrides it; `false` explicitly hides a supported
built-in page or block. Custom page visibility is the consumer's decision.
