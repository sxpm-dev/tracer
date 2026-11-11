import { Fragment, useMemo, useState } from 'react';

import type { CallPath } from './callPaths';
import type { CallPathTreeNode } from './callPathTree';
import type { CoreFunctionStat } from './coreAnalysis';
import type { CallAnalytics, FrameQuery } from './sessionData';

import { AnalyticsChart } from './AnalyticsChart';
import { buildCallPathTree } from './callPathTree';
import { formatValue, LABELS, seriesFor } from './CoreBrowserSignals';
import { DashboardIcon } from './DashboardIcon';
import { useDashboard } from './extensions';
import { FunctionPicker } from './FunctionPicker';
import { oneSecondBuckets } from './lightWindowBuckets';
import { createLocalSessionClient } from './localSessionClient';
import { metricColor } from './metricColors';
import { type MetricHelp, MetricInfo } from './MetricInfo';
import { NamespaceBadge, namespaceColor } from './NamespaceBadge';
import { namespaceMatches } from './namespaceSelection';
import { formatDuration } from './recording';
import { rowAction } from './rowAction';
import { SearchableSelect } from './SearchableSelect';
import { TraceKindIcon } from './TraceKindIcon';
import { useResource } from './useResource';
import { useTimelineRange } from './useTimelineRange';

const formatCalls = (value: number) => value.toLocaleString();
const CALLS_OVER_TIME_HELP: MetricHelp = {
  capture:
    'The recorder stores the start time of each captured function call. The dashboard counts starts in one-second intervals. Exact call timing is unavailable in light captures.',
  chart:
    'Each pink bar counts calls to the selected function during one second. Hover or focus on a bar for its count. Other series provide recording context.',
  meaning:
    'When a function is selected, this chart shows when its recorded calls occurred during the session.',
};
const CALL_PATHS_HELP: MetricHelp = {
  capture:
    'The recorder links each captured frame to its parent within the same trace. The dashboard follows those links from each call to the selected function back to the root and groups identical paths.',
  chart:
    'With Group by stack on, shared ancestors appear once. Each row counts calls through that frame; expand a row to see its children. Turn grouping off to see every distinct full path and its call count.',
  meaning:
    'The different recorded routes through functions and markers that led to calls of the selected function.',
  presentation: 'list',
};
const formatRate = (calls: number, durationMs: number) =>
  durationMs > 0
    ? `${(calls / (durationMs / 1000)).toLocaleString(undefined, { maximumFractionDigits: 1 })} calls/s`
    : '— calls/s';
function timelineQuery(query: FrameQuery): FrameQuery {
  return {
    ...query,
    from: undefined,
    name: undefined,
    parent: undefined,
    ray: undefined,
    root: undefined,
    rootsOnly: false,
    to: undefined,
  };
}

export function useExplorerClient() {
  const { recording, sessionClient } = useDashboard();
  return useMemo(
    () => sessionClient ?? createLocalSessionClient(recording),
    [recording, sessionClient],
  );
}
export function useCallAnalytics(query: FrameQuery, enabled = true) {
  const { recording } = useDashboard();
  const client = useExplorerClient();
  return useResource(
    `${recording.sessionId}:${JSON.stringify(query)}`,
    (signal) => client.analytics(recording.sessionId, query, signal),
    enabled,
  );
}
function resourceLoading(resource: {
  data?: unknown;
  error?: string;
}): boolean {
  return !resource.data && !resource.error;
}
export function useFunctionAnalysis(
  fallback: import('./coreAnalysis').CoreAnalysis,
  root: string,
  errorsOnly: boolean,
) {
  const context = useDashboard();
  const filters = functionFilters(context, root, errorsOnly);
  const resource = useCallAnalytics(
    filters,
    context.recording.mode !== 'light',
  );
  const functions =
    context.recording.mode === 'light'
      ? fallback.functions.filter(
          (item) =>
            namespaceMatches(filters.namespace, item.namespace) &&
            `${item.namespace}.${item.name}`
              .toLowerCase()
              .includes((filters.query ?? '').toLowerCase()) &&
            (filters.kind !== 'error' || item.errors > 0),
        )
      : (resource.data?.functions ?? []);
  return {
    analysis: { ...fallback, functions },
    error: context.recording.mode === 'light' ? undefined : resource.error,
    filters,
    loading:
      !resource.data && !resource.error && context.recording.mode !== 'light',
  };
}
function TimelineHeading({
  data,
  functionCounts,
  loading,
  markerAt,
}: {
  data?: CallAnalytics;
  functionCounts?: number[];
  loading: boolean;
  markerAt?: number;
}) {
  const text =
    markerAt === undefined
      ? loading
        ? 'Loading call timings…'
        : functionCounts
          ? `${Math.round(functionCounts.reduce((total, count) => total + count, 0)).toLocaleString()} calls to this function · one bar per second`
          : `${data?.total.toLocaleString() ?? '…'} calls across recording · hover for counts in each time slice`
      : `Selected call starts at ${formatDuration(markerAt)}`;
  return (
    <div className="cd-card-heading">
      <div>
        <span className="cd-eyebrow">SESSION CONTEXT</span>
        <div className="cd-metric-heading">
          <h2>
            {markerAt === undefined
              ? 'Calls over time'
              : 'This call in the recording'}
          </h2>
          <MetricInfo
            help={CALLS_OVER_TIME_HELP}
            metric="function.calls-over-time"
            title="Calls over time"
          />
        </div>
        <p>{text}</p>
      </div>
    </div>
  );
}
export function ExplorerTimeline({
  markerAt,
  query = {},
  selectable = false,
  showCallMarkers = false,
}: {
  markerAt?: number;
  query?: FrameQuery;
  selectable?: boolean;
  showCallMarkers?: boolean;
}) {
  const context = useDashboard();
  const { recording } = context;
  const resource = useCallAnalytics(timelineQuery(query));
  const focused = shouldFocusCallPaths(
    query,
    showCallMarkers,
    markerAt,
    recording.mode,
  );
  const functionResource = useCallAnalytics(
    { ...query, from: undefined, to: undefined },
    focused,
  );
  const functionCounts = focused ? functionResource.data?.counts : undefined;
  const loading =
    resourceLoading(resource) || (focused && resourceLoading(functionResource));
  return (
    <ExplorerTimelineView
      data={resource.data}
      error={resource.error ?? (focused ? functionResource.error : undefined)}
      focused={focused}
      functionCounts={functionCounts}
      loading={loading}
      markerAt={markerAt}
      query={query}
      selectable={canSelectRange(selectable, context.traceDataExcluded)}
      showCallMarkers={showCallMarkers}
    />
  );
}
function shouldFocusCallPaths(
  query: FrameQuery,
  showCallMarkers: boolean,
  markerAt: number | undefined,
  mode: string | undefined,
) {
  return (
    showCallMarkers &&
    markerAt === undefined &&
    Boolean(query.name) &&
    mode !== 'light'
  );
}
function ExplorerTimelineView({
  data,
  error,
  focused,
  functionCounts,
  loading,
  markerAt,
  query,
  selectable,
  showCallMarkers,
}: {
  data?: CallAnalytics;
  error?: string;
  focused: boolean;
  functionCounts?: number[];
  loading: boolean;
  markerAt?: number;
  query: FrameQuery;
  selectable: boolean;
  showCallMarkers: boolean;
}) {
  const { analysis, recording } = useDashboard();
  const { range, selectRange } = useTimelineRange();
  const markers = markerAt === undefined ? [] : [{ at: markerAt, count: 1 }];
  const series = explorerSeries(
    data,
    analysis.timelineBlocking,
    recording.duration,
    focused,
    functionCounts,
  );
  return (
    <section className="cd-card cd-explorer-timeline">
      <TimelineHeading
        data={data}
        functionCounts={functionCounts}
        loading={loading}
        markerAt={markerAt}
      />
      <AnalyticsChart
        bucketMs={1_000}
        duration={recording.duration}
        loading={loading}
        markers={markers}
        onRange={selectable ? selectRange : undefined}
        onSelect={() => undefined}
        range={selectable ? range : undefined}
        series={series}
        variant={focused ? 'bar' : 'line'}
      />
      {selectable && (
        <TimelineCallSummary
          data={data}
          error={error}
          query={timelineQuery(query)}
          recordingDuration={recording.duration}
        />
      )}
      <TimelineFooter
        error={error}
        light={recording.mode === 'light'}
        markerAt={markerAt}
        selectable={selectable}
        showCallMarkers={showCallMarkers}
      />
      {focused && (
        <FunctionCallPaths
          query={{ ...query, from: undefined, to: undefined }}
        />
      )}
      <details className="cd-context-signals" open={!selectable}>
        <summary>
          Browser signals · memory, rendering and responsiveness
        </summary>
        <BrowserContextCharts markers={markers} selectable={selectable} />
      </details>
    </section>
  );
}
function explorerSeries(
  data: CallAnalytics | undefined,
  blocking: number[] | undefined,
  duration: number,
  focused: boolean,
  functionCounts: number[] | undefined,
) {
  const contextSeries = [
    {
      color: metricColor('resource.transfer-size'),
      format: formatCalls,
      label: 'Root calls',
      tooltipOnly: true,
      values: data?.chartRootCounts ?? oneSecondBuckets(duration),
    },
    {
      color: metricColor('function.calls'),
      format: formatCalls,
      label: 'All frames',
      values: data?.chartCounts ?? oneSecondBuckets(duration),
    },
    {
      color: metricColor('thread.blocking'),
      format: formatDuration,
      label: 'Main-thread blocking',
      values: blocking ?? oneSecondBuckets(duration),
    },
  ];
  return focused
    ? [
        {
          color: 'var(--cd-call-marker, #be185d)',
          format: (value: number) => Math.round(value).toLocaleString(),
          label: 'This function',
          values: functionCounts ?? oneSecondBuckets(duration),
        },
        ...contextSeries.map((item) => ({ ...item, tooltipOnly: true })),
      ]
    : contextSeries;
}
function FunctionCallPaths({ query }: { query: FrameQuery }) {
  const { recording } = useDashboard();
  const client = useExplorerClient();
  const [groupByStack, setGroupByStack] = useState(true);
  const resource = useResource(
    `${recording.sessionId}:call-paths:${JSON.stringify(query)}`,
    (signal) => client.callPaths(recording.sessionId, query, signal),
  );
  return (
    <details className="cd-context-signals cd-call-paths" open>
      <summary>Call paths</summary>
      <div className="cd-call-path-info">
        <MetricInfo
          help={CALL_PATHS_HELP}
          metric="function.call-paths"
          title="Call paths"
        />
      </div>
      <label className="cd-checkbox cd-call-path-controls">
        <input
          checked={groupByStack}
          onChange={(event) => setGroupByStack(event.target.checked)}
          type="checkbox"
        />
        Group by stack
      </label>
      {resource.error ? (
        <p role="alert">Could not load call paths.</p>
      ) : !resource.data ? (
        <div
          aria-label="Loading call paths"
          className="cd-call-path-loading"
          role="status"
        >
          <span aria-hidden="true" className="cd-spinner" />
          <span>Loading call paths…</span>
        </div>
      ) : !resource.data.length ? (
        <p>No call paths found for this function.</p>
      ) : (
        <>
          {groupByStack && (
            <p className="cd-call-path-explainer">
              Shared caller chains appear once. Expand a row to follow its
              paths; counts include all calls beneath it.
            </p>
          )}
          <div className="cd-call-path-scroll">
            {groupByStack ? (
              <GroupedCallPathTree paths={resource.data} />
            ) : (
              <FlatCallPaths paths={resource.data} />
            )}
          </div>
        </>
      )}
    </details>
  );
}
function FlatCallPaths({ paths }: { paths: CallPath[] }) {
  return (
    <ol className="cd-call-path-list">
      {paths.map((path) => (
        <li key={JSON.stringify(path.frames)}>
          <span className="cd-call-path-frames">
            {path.frames.map((frame, index) => (
              <span className="cd-call-path-part" key={index}>
                <span aria-hidden="true" className="cd-call-path-arrow">
                  {index > 0 ? '→' : ''}
                </span>
                <span className="cd-call-path-step">
                  <NamespaceBadge name={frame.namespace} />
                  <TraceKindIcon kind={frame.kind} />
                  <span className="cd-call-path-name">{frame.name}</span>
                </span>
              </span>
            ))}
          </span>
          <span className="cd-call-path-count">
            {formatCalls(path.calls)} {path.calls === 1 ? 'call' : 'calls'}
          </span>
        </li>
      ))}
    </ol>
  );
}
function GroupedCallPathTree({ paths }: { paths: CallPath[] }) {
  const roots = useMemo(() => buildCallPathTree(paths), [paths]);
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const expanded = (node: CallPathTreeNode) =>
    toggled.has(node.id) ? node.depth >= 2 : node.depth < 2;
  const toggle = (id: string) =>
    setToggled((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  return (
    <table
      aria-label="Grouped call paths"
      className="cd-table cd-call-path-tree"
    >
      <thead>
        <tr>
          <th>Namespace</th>
          <th className="cd-trace-name-column">Shared call stack</th>
          <th>Calls through</th>
        </tr>
      </thead>
      <tbody>
        <CallPathTreeRows
          ancestors={[]}
          expanded={expanded}
          nodes={roots}
          onToggle={toggle}
        />
      </tbody>
    </table>
  );
}
function CallPathTreeRows({
  ancestors,
  expanded,
  nodes,
  onToggle,
}: {
  ancestors: CallPathTreeNode[];
  expanded: (node: CallPathTreeNode) => boolean;
  nodes: CallPathTreeNode[];
  onToggle: (id: string) => void;
}) {
  return nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    const open = expanded(node);
    return (
      <Fragment key={node.id}>
        <tr
          className={hasChildren ? 'cd-clickable-row' : undefined}
          {...(hasChildren ? rowAction(() => onToggle(node.id)) : {})}
        >
          <td className="cd-namespace-column">
            <NamespaceBadge name={node.frame.namespace} />
          </td>
          <td className="cd-trace-name-column">
            <div className="cd-tree-function">
              <CallPathTreeGuides ancestors={ancestors} node={node} />
              {hasChildren ? (
                <button
                  aria-expanded={open}
                  aria-label={`${open ? 'Collapse' : 'Expand'} ${node.frame.name}`}
                  className="cd-tree-toggle"
                  onClick={() => onToggle(node.id)}
                  type="button"
                >
                  <DashboardIcon name={open ? 'caret-down' : 'caret-right'} />
                </button>
              ) : (
                <span className="cd-tree-spacer" />
              )}
              <div className="cd-function-name cd-function-inline">
                <TraceKindIcon kind={node.frame.kind} />
                <strong title={node.frame.name}>{node.frame.name}</strong>
              </div>
              {node.paths > 1 && (
                <span
                  className="cd-call-path-branch-count"
                  title={`${formatCalls(node.paths)} distinct call paths share this caller chain`}
                >
                  {formatCalls(node.paths)} paths
                </span>
              )}
            </div>
          </td>
          <td className="cd-call-path-tree-count">{formatCalls(node.calls)}</td>
        </tr>
        {hasChildren && open && (
          <CallPathTreeRows
            ancestors={[...ancestors, node]}
            expanded={expanded}
            nodes={node.children}
            onToggle={onToggle}
          />
        )}
      </Fragment>
    );
  });
}
function CallPathTreeGuides({
  ancestors,
  node,
}: {
  ancestors: CallPathTreeNode[];
  node: CallPathTreeNode;
}) {
  const depth = Math.min(node.depth, 16);
  return Array.from({ length: depth }, (_, level) => {
    const elbow = level === depth - 1;
    const branch = elbow ? node : ancestors[level + 1];
    return (
      <span
        aria-hidden="true"
        className={`cd-tree-guide ${elbow ? 'is-elbow' : ''} ${branch?.hasNextSibling ? 'is-continuation' : ''}`}
        key={level}
      />
    );
  });
}
function TimelineCallSummary({
  data,
  error,
  query,
  recordingDuration,
}: {
  data?: CallAnalytics;
  error?: string;
  query: FrameQuery;
  recordingDuration: number;
}) {
  const { navigation } = useDashboard();
  const from = navigation?.state.from;
  const to = navigation?.state.to;
  const selected = from !== undefined || to !== undefined;
  const clear = () =>
    navigation?.onChange({
      ...navigation.state,
      frameOffset: 0,
      from: undefined,
      to: undefined,
    });
  return selected ? (
    <SelectedCallSummary
      clear={clear}
      from={from ?? 0}
      query={query}
      to={to ?? recordingDuration}
    />
  ) : (
    <CallSummary
      data={data}
      duration={recordingDuration}
      error={error}
      label="Entire recording"
    />
  );
}
function SelectedCallSummary({
  clear,
  from,
  query,
  to,
}: {
  clear: () => void;
  from: number;
  query: FrameQuery;
  to: number;
}) {
  const resource = useCallAnalytics({ ...query, from, to });
  return (
    <CallSummary
      clear={clear}
      data={resource.data}
      duration={Math.max(0, to - from)}
      error={resource.error}
      label={`Selected ${formatDuration(from)}–${formatDuration(to)}`}
    />
  );
}
function CallSummary({
  clear,
  data,
  duration,
  error,
  label,
}: {
  clear?: () => void;
  data?: CallAnalytics;
  duration: number;
  error?: string;
  label: string;
}) {
  return (
    <div aria-label="Call totals" className="cd-call-summary" role="region">
      <strong>{label}</strong>
      {error ? (
        <span role="alert">Could not load call totals.</span>
      ) : (
        <div className="cd-call-summary-metrics">
          <span>
            Root calls <b>{data ? formatCalls(data.rootTotal) : '…'}</b>{' '}
            <small>{data ? formatRate(data.rootTotal, duration) : '…'}</small>
          </span>
          <span>
            All frames <b>{data ? formatCalls(data.total) : '…'}</b>{' '}
            <small>{data ? formatRate(data.total, duration) : '…'}</small>
          </span>
        </div>
      )}
      <button
        className={`cd-button${clear ? '' : ' is-placeholder'}`}
        disabled={!clear}
        onClick={clear}
        type="button"
      >
        Clear selection
      </button>
    </div>
  );
}
function BrowserContextCharts({
  markers,
  selectable,
}: {
  markers: { at: number; count: number }[];
  selectable: boolean;
}) {
  const { browserSummary, recording } = useDashboard();
  const { range, selectRange } = useTimelineRange();
  const runtime = browserSummary?.series ?? seriesFor(recording);
  return (
    <>
      {!runtime.length && (
        <p className="cd-browser-empty">
          Browser signals were not captured in this recording.
        </p>
      )}
      {runtime.map((item) => (
        <section
          aria-label={LABELS[item.metric] ?? item.metric}
          key={item.metric}
        >
          <div className="cd-metric-heading">
            <h3>{LABELS[item.metric] ?? item.metric}</h3>
            <MetricInfo
              metric={item.metric}
              title={LABELS[item.metric] ?? item.metric}
            />
          </div>
          <AnalyticsChart
            bucketMs={1_000}
            compact
            duration={recording.duration}
            markers={markers}
            onRange={selectable ? selectRange : undefined}
            onSelect={() => undefined}
            range={selectable ? range : undefined}
            series={[
              {
                color: metricColor(item.metric),
                counts: item.counts,
                format: (value) => formatValue(value, item.unit),
                label: LABELS[item.metric] ?? item.metric,
                values: item.points,
              },
            ]}
            variant="bar"
          />
        </section>
      ))}
    </>
  );
}
function TimelineFooter({
  error,
  light,
  markerAt,
  selectable,
  showCallMarkers,
}: {
  error?: string;
  light: boolean;
  markerAt?: number;
  selectable: boolean;
  showCallMarkers: boolean;
}) {
  return (
    <>
      {showCallMarkers && (
        <p className="cd-table-hint">
          {markerAt === undefined
            ? light
              ? 'Per-function call timing is unavailable in light capture; this chart shows all calls.'
              : 'Each pink bar shows calls to this function during one second. Hover for the count.'
            : `The pink line marks the selected call’s start at ${formatDuration(markerAt)} on every chart.`}
        </p>
      )}
      {selectable && (
        <p className="cd-table-hint">
          Click and drag across the chart to select a time range.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
function pickerOptions(
  options: CoreFunctionStat[] | undefined,
  fallback: CoreFunctionStat[],
) {
  return options ?? fallback;
}
export function ExplorerFilters({
  embedded = false,
  functionOptions,
  functions = false,
  onFunctionSelect,
  showRootCallsOnly = true,
}: {
  embedded?: boolean;
  functionOptions?: CoreFunctionStat[];
  functions?: boolean;
  onFunctionSelect?: (item: CoreFunctionStat) => void;
  showRootCallsOnly?: boolean;
}) {
  const { analysis, navigation, recording, traceDataExcluded } = useDashboard();
  if (!navigation) {
    return null;
  }
  const view = navigation.state;
  const update = (key: string, value: string) =>
    navigation.onChange(
      { ...view, frame: undefined, frameOffset: 0, [key]: value || undefined },
      true,
    );
  return (
    <div className={`cd-explorer-filters ${embedded ? '' : 'cd-card'}`}>
      <div className="cd-filter-fields">
        <SearchableSelect
          label="Namespace"
          multiple
          onChange={(value) => update('namespace', value)}
          options={[
            { label: 'All namespaces', value: '' },
            ...[...new Set(analysis.functions.map((item) => item.namespace))]
              .sort()
              .map((name) => ({
                color: namespaceColor(name),
                label: name,
                value: name,
              })),
          ]}
          value={view.namespace ?? ''}
        />
        <FunctionPicker
          functions={pickerOptions(functionOptions, analysis.functions)}
          namespace={view.namespace}
          onChange={(value) =>
            navigation.onChange(
              {
                ...view,
                frame: undefined,
                frameOffset: functions ? undefined : 0,
                frameQuery: value || undefined,
                ...(functions ? { query: undefined } : {}),
              },
              true,
            )
          }
          onSelect={onFunctionSelect}
          value={functionFilterValue(view, functions)}
        />
        {showExactFilter(recording.mode, functions, traceDataExcluded) &&
          (['minDuration', 'maxDuration'] as const).map((key, index) => (
            <label key={key}>
              {index ? 'Maximum' : 'Minimum'} duration (ms)
              <input
                aria-label={`${index ? 'Maximum' : 'Minimum'} duration (ms)`}
                min="0"
                onChange={(e) =>
                  navigation.onChange(
                    {
                      ...view,
                      frameOffset: 0,
                      [key]:
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value),
                    },
                    true,
                  )
                }
                type="number"
                value={view[key] ?? ''}
              />
            </label>
          ))}
      </div>
      <div className="cd-filter-options">
        {showExactFilter(
          recording.mode,
          showRootCallsOnly,
          traceDataExcluded,
        ) && (
          <label className="cd-checkbox">
            <input
              checked={view.rootsOnly === 'true'}
              onChange={(e) =>
                update('rootsOnly', e.target.checked ? 'true' : '')
              }
              type="checkbox"
            />
            Root calls only
          </label>
        )}
        <label className="cd-checkbox">
          <input
            checked={view.kind === 'error'}
            disabled={traceDataExcluded}
            onChange={(e) => update('kind', e.target.checked ? 'error' : '')}
            type="checkbox"
          />
          Failed calls only
        </label>
        <button
          className="cd-button"
          onClick={() =>
            navigation.onChange({ page: functions ? 'functions' : 'frames' })
          }
        >
          Reset filters
        </button>
      </div>
    </div>
  );
}
function showExactFilter(
  mode: string | undefined,
  requested: boolean,
  excluded = false,
) {
  return !excluded && mode !== 'light' && requested;
}
export function explorerQuery(
  view: Omit<FrameQuery, 'rootsOnly'> & {
    frameQuery?: string;
    rootsOnly?: string;
  },
) {
  return {
    from: view.from,
    kind: view.kind,
    maxDuration: view.maxDuration,
    minDuration: view.minDuration,
    name: view.name,
    namespace: view.namespace,
    parent: view.parent,
    query: view.frameQuery,
    ray: view.ray,
    root: view.root,
    rootsOnly: view.rootsOnly === 'true',
    to: view.to,
  };
}

function functionFilters(
  context: ReturnType<typeof useDashboard>,
  root: string,
  errorsOnly: boolean,
) {
  const view = context.navigation?.state ?? { page: 'functions' };
  return {
    ...explorerQuery(view),
    kind: view.kind === 'error' || errorsOnly ? 'error' : undefined,
    query: view.frameQuery ?? context.query,
    root,
  };
}

function canSelectRange(selectable: boolean, excluded = false) {
  return selectable && !excluded;
}
function functionFilterValue(
  view: import('./navigation').DashboardViewState,
  functions: boolean,
) {
  return view.frameQuery ?? (functions ? view.query : undefined) ?? '';
}
