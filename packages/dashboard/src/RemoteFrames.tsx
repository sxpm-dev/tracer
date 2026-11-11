import { useState } from 'react';

import type { CoreFunctionStat } from './coreAnalysis';
import type { DashboardNavigation } from './navigation';

import {
  type CoreDashboardExtensions,
  FrameInspector,
  FunctionDrawer,
} from './CoreRecordingDashboard';
import { DashboardIcon } from './DashboardIcon';
import {
  ExplorerFilters,
  explorerQuery,
  ExplorerTimeline,
  useCallAnalytics,
} from './ExplorerTimeline';
import {
  DashboardBlock,
  DashboardContextProvider,
  useDashboard,
} from './extensions';
import { InspectorDrawer } from './InspectorDrawer';
import { NamespaceBadge } from './NamespaceBadge';
import { namespaceMatches } from './namespaceSelection';
import { formatDuration } from './recording';
import { RootTraceGroups } from './RootTraceGroups';
import { rowAction } from './rowAction';
import {
  type FrameItem,
  type FramePage,
  type FrameQuery,
  SESSION_PAGE_SIZE,
  type SessionClient,
} from './sessionData';
import { TableLoader } from './TableLoader';
import { TraceKindIcon } from './TraceKindIcon';
import { useResource } from './useResource';

export function PageControls({
  offset,
  onChange,
  total,
}: {
  offset: number;
  onChange: (offset: number) => void;
  total: number;
}) {
  return (
    <div className="cd-pagination">
      <button
        className="cd-button"
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - SESSION_PAGE_SIZE))}
      >
        <DashboardIcon name="arrow-left" /> Previous
      </button>
      <span>
        {total
          ? `${Math.min(offset + 1, total)}–${Math.min(offset + SESSION_PAGE_SIZE, total)} of ${total.toLocaleString()}`
          : 'No results'}
      </span>
      <button
        className="cd-button"
        disabled={offset + SESSION_PAGE_SIZE >= total}
        onClick={() => onChange(offset + SESSION_PAGE_SIZE)}
      >
        Next <DashboardIcon name="arrow-right" />
      </button>
    </div>
  );
}
type Props = {
  client: SessionClient;
  extensions: CoreDashboardExtensions;
  navigation: DashboardNavigation;
  sessionId: string;
};
export function RemoteFrames({
  client,
  extensions,
  navigation,
  sessionId,
}: Props) {
  const rootFunctions = useCallAnalytics({ rootsOnly: true });
  return (
    <div className="cd-stack">
      <ExplorerTimeline
        query={{
          ...explorerQuery(navigation.state),
          maxDuration: undefined,
          minDuration: undefined,
          query:
            navigation.state.parent === undefined
              ? navigation.state.frameQuery
              : undefined,
        }}
        selectable
      />
      <div className="cd-card cd-call-controls">
        <ExplorerFilters
          embedded
          functionOptions={rootFunctions.data?.functions ?? []}
          onFunctionSelect={(item) => selectRootFunction(navigation, item)}
          showRootCallsOnly={false}
        />
      </div>
      <TraceBreadcrumbs navigation={navigation} />
      {navigation.state.parent === undefined &&
      navigation.state.frame === undefined &&
      !traceFunctionId(navigation) ? (
        <RootTraceGroups navigation={navigation} />
      ) : (
        <FrameTable
          client={client}
          extensions={extensions}
          navigation={navigation}
          sessionId={sessionId}
        />
      )}
    </div>
  );
}
function selectRootFunction(
  navigation: DashboardNavigation,
  item: CoreFunctionStat,
) {
  navigation.onChange({
    ...navigation.state,
    breadcrumbs: undefined,
    frame: undefined,
    frameOffset: 0,
    frameQuery: `${item.namespace}.${item.name}`,
    frameRay: undefined,
    functionId: `${item.namespace}\0${item.name}`,
    name: undefined,
    page: 'frames',
    parent: undefined,
    ray: undefined,
    root: undefined,
    tree: 'roots',
  });
}
function frameQuery(view: DashboardNavigation['state']): FrameQuery {
  return {
    ...functionFrameFilter(view),
    from: view.from,
    kind: view.kind,
    offset: view.frameOffset,
    parent: view.parent,
    query: view.parent === undefined ? view.frameQuery : undefined,
    ray: view.ray,
    root: view.root,
    rootsOnly:
      view.rootsOnly === 'true' ||
      (view.tree === 'roots' && view.parent === undefined) ||
      (!view.name && view.tree !== 'matches' && view.parent === undefined),
    sort: view.parent === undefined ? view.sort : undefined,
    subtree: view.parent,
    to: view.to,
  };
}
function functionFrameFilter(view: DashboardNavigation['state']) {
  if (view.parent !== undefined) {
    return { name: undefined, namespace: view.namespace };
  }
  if (!view.functionId) {
    return { name: view.name, namespace: view.namespace };
  }
  const [namespace, name] = view.functionId.split('\0');
  return {
    name,
    namespace: namespaceMatches(view.namespace, namespace)
      ? namespace
      : '__filtered_out__',
  };
}
function frameTitle(view: DashboardNavigation['state']) {
  if (view.parent !== undefined) {
    return 'Call stack';
  }
  return view.functionId?.split('\0')[1] || view.name || 'Root traces';
}
function FrameTable({ client, extensions, navigation, sessionId }: Props) {
  const { onChange, state: view } = navigation;
  const query = frameQuery(view);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detailsId, setDetailsId] = useState('');
  const resource = useResource(
    `${sessionId}:${JSON.stringify(query)}`,
    (signal) => client.frames(sessionId, query, signal),
  );
  const items = resource.data?.items ?? [];
  const nextSiblings = siblingBranches(items);
  const parentsOnPage = visibleParents(items);
  const sort = (column: 'duration' | 'time') =>
    onChange({
      ...view,
      frameOffset: 0,
      sort:
        view.sort === column
          ? `${column}-${column === 'time' ? 'desc' : 'asc'}`
          : column,
    });
  return (
    <section className="cd-card cd-frame-table">
      <FrameTableHeading
        navigation={navigation}
        onDetails={setDetailsId}
        total={resource.data?.total}
      />
      <div className="cd-table-scroll">
        <table className="cd-table">
          <thead>
            <tr>
              <th className="cd-namespace-column">Namespace</th>
              <th className="cd-trace-name-column">Function / marker</th>
              <th>Status</th>
              <FrameSort
                column="time"
                disabled={view.parent !== undefined}
                label="Start"
                onSort={sort}
                sort={view.sort}
              />
              <FrameSort
                column="duration"
                disabled={view.parent !== undefined}
                label="Duration"
                onSort={sort}
                sort={view.sort}
              />
              <th>Call tree</th>
            </tr>
          </thead>
          <tbody>
            <TableLoader
              columns={6}
              error={resource.error}
              label="Loading frames"
              loading={!resource.data}
            >
              {resource.data?.items
                .filter(
                  (event) =>
                    !(event.ancestors ?? []).some((parent) =>
                      collapsed.has(`${event.ray}:${parent.id}`),
                    ),
                )
                .map((event) => (
                  <CallRow
                    event={event}
                    expanded={!collapsed.has(`${event.ray}:${event.id}`)}
                    hasVisibleChildren={parentsOnPage.has(
                      `${event.ray}:${event.id}`,
                    )}
                    key={`${event.ray}:${event.id}`}
                    navigation={navigation}
                    nextSiblings={nextSiblings}
                    onToggle={() =>
                      setCollapsed((previous) => {
                        const next = new Set(previous);
                        const key = `${event.ray}:${event.id}`;
                        if (next.has(key)) {
                          next.delete(key);
                        } else {
                          next.add(key);
                        }
                        return next;
                      })
                    }
                  />
                ))}
            </TableLoader>
          </tbody>
        </table>
      </div>
      {resource.data && (
        <PageControls
          offset={query.offset ?? 0}
          onChange={(offset) =>
            onChange({ ...view, frame: undefined, frameOffset: offset })
          }
          total={resource.data.total}
        />
      )}
      {view.frame !== undefined && (
        <FrameDrawer
          client={client}
          data={resource.data}
          extensions={extensions}
          navigation={navigation}
          query={query}
          sessionId={sessionId}
        />
      )}
      <TraceFunctionDetails
        functionId={detailsId}
        navigation={navigation}
        onClose={() => setDetailsId('')}
      />
    </section>
  );
}
function FrameTableHeading({
  navigation,
  onDetails,
  total,
}: {
  navigation: DashboardNavigation;
  onDetails: (id: string) => void;
  total?: number;
}) {
  const view = navigation.state;
  const selectedId =
    view.parent === undefined ? traceFunctionId(navigation) : undefined;
  const functionId = selectedId?.startsWith('\0') ? undefined : selectedId;
  return (
    <div className="cd-card-heading">
      <div>
        <span className="cd-eyebrow">TRACE EXPLORER</span>
        <div className="cd-call-stack-heading">
          <TraceBackButton navigation={navigation} />
          <h2>{frameTitle(view)}</h2>
          {functionId && (
            <button
              aria-label={`Inspect function ${functionId.replace('\0', '.')}`}
              className="cd-icon-button"
              onClick={() => onDetails(functionId)}
              title="Inspect function"
              type="button"
            >
              <DashboardIcon name="package" />
            </button>
          )}
        </div>
        <p>{rowHint(view.parent)}</p>
      </div>
      <span className="cd-count-pill">
        {total?.toLocaleString() ?? '…'}{' '}
        {view.parent !== undefined ? 'frames' : 'traces'}
      </span>
    </div>
  );
}
function TraceFunctionDetails({
  functionId,
  navigation,
  onClose,
}: {
  functionId: string;
  navigation: DashboardNavigation;
  onClose: () => void;
}) {
  if (
    !functionId ||
    navigation.state.parent !== undefined ||
    functionId !== traceFunctionId(navigation)
  ) {
    return null;
  }
  return (
    <LoadedTraceFunctionDetails
      functionId={functionId}
      onClose={onClose}
      view={navigation.state}
    />
  );
}
function LoadedTraceFunctionDetails({
  functionId,
  onClose,
  view,
}: {
  functionId: string;
  onClose: () => void;
  view: DashboardNavigation['state'];
}) {
  const [namespace, name] = functionId.split('\0');
  const filters = {
    ...frameQuery(view),
    functionLimit: 1,
    offset: undefined,
    sort: undefined,
  };
  const resource = useCallAnalytics(filters);
  const item = resource.data?.functions.find(
    (entry) => entry.namespace === namespace && entry.name === name,
  );
  return (
    <FunctionDrawer
      error={resource.error}
      filters={filters}
      identity={{ name, namespace }}
      item={item}
      loading={!resource.data && !resource.error}
      onClose={onClose}
    />
  );
}
function FrameSort({
  column,
  disabled,
  label,
  onSort,
  sort,
}: {
  column: 'duration' | 'time';
  disabled: boolean;
  label: string;
  onSort: (column: 'duration' | 'time') => void;
  sort?: string;
}) {
  if (disabled) {
    return <th>{label}</th>;
  }
  const active = sort?.startsWith(column);
  const descending = sort === 'duration' || sort === 'time-desc';
  return (
    <th aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'}>
      <button className="cd-sort-heading" onClick={() => onSort(column)}>
        {label}{' '}
        <DashboardIcon
          name={active ? (descending ? 'arrow-down' : 'arrow-up') : 'sort'}
          size={12}
        />
      </button>
    </th>
  );
}
function FrameDrawer({
  client,
  data,
  extensions,
  navigation,
  query,
  sessionId,
}: {
  client: SessionClient;
  data?: FramePage;
  extensions: CoreDashboardExtensions;
  navigation: DashboardNavigation;
  query: FrameQuery;
  sessionId: string;
}) {
  const { onChange, state: view } = navigation;
  const context = useDashboard();
  const { error, event, loaded, metadata, statusData } = useFrameSelection(
    client,
    data,
    query,
    sessionId,
    view,
  );
  const close = () =>
    onChange({ ...view, frame: undefined, frameRay: undefined });
  return (
    <InspectorDrawer
      companion={
        event && (
          <ExplorerTimeline
            markerAt={event.at}
            query={{ name: event.name, namespace: event.namespace }}
            showCallMarkers
          />
        )
      }
      onClose={close}
      subtitle={event ? event.namespace : ''}
      title={event ? event.name : `Frame #${view.frame}`}
    >
      <DashboardContextProvider
        value={{ ...context, selectedFrame: event, selectedRay: event?.ray }}
      >
        <DashboardBlock id="frames.inspector">
          <ResourceStatus
            data={statusData}
            error={error}
            label="frame details"
          />
          {event && (
            <FrameInspector
              event={event}
              extensions={extensions}
              rayMetadata={metadata}
            />
          )}
          {loaded && !event && (
            <p>That frame is not available in this snapshot.</p>
          )}
        </DashboardBlock>
      </DashboardContextProvider>
    </InspectorDrawer>
  );
}
function useFrameSelection(
  client: SessionClient,
  data: FramePage | undefined,
  query: FrameQuery,
  sessionId: string,
  view: DashboardNavigation['state'],
) {
  const selectedQuery = {
    ...query,
    frame: view.frame,
    frameRay: view.frameRay,
  };
  const selection = useResource(
    `${sessionId}:${JSON.stringify(selectedQuery)}`,
    (signal) => client.frames(sessionId, selectedQuery, signal),
  );
  const event =
    selection.data?.selected ??
    data?.items.find(
      (item) =>
        item.id === view.frame && item.ray === (view.frameRay ?? view.ray),
    );
  return {
    error: selection.error,
    event,
    loaded: Boolean(selection.data),
    metadata: selection.data?.metadata ?? data?.metadata,
    statusData: event ?? selection.data,
  };
}
function ResourceStatus({
  data,
  error,
  label,
}: {
  data?: unknown;
  error?: string;
  label: string;
}) {
  if (error) {
    return (
      <p className="cd-remote-search" role="alert">
        {error}
      </p>
    );
  }
  return data ? null : (
    <p className="cd-remote-search" role="status">
      Loading {label}…
    </p>
  );
}

type Crumb = { id: number; name: string; ray: string };
function crumbsFor(navigation: DashboardNavigation): Crumb[] {
  try {
    return JSON.parse(navigation.state.breadcrumbs ?? '[]') as Crumb[];
  } catch {
    return [];
  }
}
function drilldown(navigation: DashboardNavigation, event: FrameItem) {
  const crumbs = [
    ...crumbsFor(navigation),
    ...(event.ancestors ?? []).map((item) => ({ ...item, ray: event.ray })),
    { id: event.id, name: event.name, ray: event.ray },
  ];
  navigation.onChange({
    ...navigation.state,
    breadcrumbs: JSON.stringify(crumbs),
    frameOffset: 0,
    functionId:
      traceFunctionId(navigation) ??
      `${event.namespace ?? 'unknown'}\0${event.name}`,
    page: 'frames',
    parent: event.id,
    ray: event.ray,
    tree: navigation.state.tree,
  });
}
function traceFunctionId(navigation: DashboardNavigation) {
  const { functionId, name, namespace } = navigation.state;
  return functionId ?? (name ? `${namespace ?? ''}\0${name}` : undefined);
}
function FunctionBreadcrumb({
  navigation,
}: {
  navigation: DashboardNavigation;
}) {
  const id = traceFunctionId(navigation);
  if (!id) {
    return null;
  }
  const name = id.split('\0')[1];
  return (
    <span>
      <DashboardIcon name="caret-right" />
      <button
        aria-current={
          navigation.state.parent === undefined ? 'page' : undefined
        }
        className="cd-button"
        onClick={() =>
          navigation.onChange({
            ...navigation.state,
            breadcrumbs: undefined,
            frameOffset: 0,
            functionId: id,
            page: 'frames',
            parent: undefined,
            ray: undefined,
            tree: navigation.state.tree ?? 'matches',
          })
        }
      >
        {name}
      </button>
    </span>
  );
}
function goBackTrace(navigation: DashboardNavigation) {
  const crumbs = crumbsFor(navigation).slice(0, -1);
  const parent = crumbs.at(-1);
  const functionId = traceFunctionId(navigation);
  if (parent) {
    navigation.onChange({
      ...navigation.state,
      breadcrumbs: JSON.stringify(crumbs),
      functionId,
      page: 'frames',
      parent: parent.id,
      ray: parent.ray,
      tree: navigation.state.tree,
    });
  } else if (navigation.state.parent !== undefined && functionId) {
    navigation.onChange({
      ...navigation.state,
      breadcrumbs: undefined,
      frameOffset: 0,
      functionId,
      page: 'frames',
      parent: undefined,
      ray: undefined,
      tree: navigation.state.tree ?? 'matches',
    });
  } else {
    showRootTraces(navigation);
  }
}
function showRootTraces(navigation: DashboardNavigation) {
  navigation.onChange({
    ...navigation.state,
    breadcrumbs: undefined,
    frameOffset: 0,
    functionId: undefined,
    name: undefined,
    page: 'frames',
    parent: undefined,
    ray: undefined,
    tree: undefined,
  });
}
function TraceBackButton({ navigation }: { navigation: DashboardNavigation }) {
  if (navigation.state.parent === undefined && !traceFunctionId(navigation)) {
    return null;
  }
  return (
    <button
      className="cd-button cd-trace-back-button"
      onClick={() => goBackTrace(navigation)}
      title="Go up one breadcrumb"
      type="button"
    >
      <DashboardIcon name="arrow-left" />
      <span>Back</span>
    </button>
  );
}
function TraceBreadcrumbs({ navigation }: { navigation: DashboardNavigation }) {
  const crumbs = crumbsFor(navigation);
  return (
    <nav aria-label="Trace drilldown" className="cd-trace-breadcrumbs">
      <button className="cd-button" onClick={() => showRootTraces(navigation)}>
        All root traces
      </button>
      <FunctionBreadcrumb navigation={navigation} />
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.ray}:${crumb.id}`}>
          <DashboardIcon name="caret-right" />
          <button
            aria-current={index === crumbs.length - 1 ? 'page' : undefined}
            className="cd-button"
            onClick={() =>
              navigation.onChange({
                ...navigation.state,
                breadcrumbs: JSON.stringify(crumbs.slice(0, index + 1)),
                functionId: traceFunctionId(navigation),
                page: 'frames',
                parent: crumb.id,
                ray: crumb.ray,
                tree: navigation.state.tree,
              })
            }
          >
            {crumb.name} ({crumb.ray})
          </button>
        </span>
      ))}
    </nav>
  );
}
function callRowInteraction(
  inStack: boolean,
  hasChildren: boolean,
  expanded: boolean,
  activate: () => void,
) {
  if (inStack && !hasChildren) {
    return {};
  }
  return {
    ...rowAction(activate),
    className:
      hasChildren && !expanded
        ? 'cd-tree-collapsed cd-clickable-row'
        : 'cd-clickable-row',
  };
}
function siblingBranches(items: FrameItem[]) {
  const lastByParent = new Map<string, string>();
  const hasNext = new Set<string>();
  for (const item of items) {
    const parent = `${item.ray}:${(item.ancestors ?? []).map((ancestor) => ancestor.id).join('/')}`;
    const previous = lastByParent.get(parent);
    if (previous) {
      hasNext.add(previous);
    }
    lastByParent.set(parent, `${item.ray}:${item.id}`);
  }
  return hasNext;
}
function visibleParents(items: FrameItem[]) {
  return new Set(
    items
      .filter((item) => item.parent !== undefined)
      .map((item) => `${item.ray}:${item.parent}`),
  );
}
function TreeGuides({
  event,
  expanded,
  hasVisibleChildren,
  nextSiblings,
}: {
  event: FrameItem;
  expanded: boolean;
  hasVisibleChildren: boolean;
  nextSiblings: Set<string>;
}) {
  const depth = Math.min(event.depth ?? 0, 16);
  return (
    <>
      {Array.from({ length: depth }, (_, level) => {
        const elbow = level === depth - 1;
        const branchId = elbow ? event.id : event.ancestors?.[level + 1]?.id;
        const continues = nextSiblings.has(`${event.ray}:${branchId}`);
        return (
          <span
            aria-hidden="true"
            className={`cd-tree-guide ${elbow ? 'is-elbow' : ''} ${continues ? 'is-continuation' : ''}`}
            key={level}
          />
        );
      })}
      {hasVisibleChildren && expanded ? (
        <span
          aria-hidden="true"
          className="cd-tree-stem"
          style={{ left: depth * 20 + 12 }}
        />
      ) : null}
    </>
  );
}
function CallRow({
  event,
  expanded,
  hasVisibleChildren,
  navigation,
  nextSiblings,
  onToggle,
}: {
  event: FrameItem;
  expanded: boolean;
  hasVisibleChildren: boolean;
  navigation: DashboardNavigation;
  nextSiblings: Set<string>;
  onToggle: () => void;
}) {
  const hasChildren = hasVisibleChildren;
  const hasRecordedChildren = Boolean(event.childCount);
  const inStack = navigation.state.parent !== undefined;
  const inspect = () =>
    navigation.onChange({
      ...navigation.state,
      frame: event.id,
      frameRay: event.ray,
    });
  const activate = () => {
    if (inStack) {
      onToggle();
    } else {
      drilldown(navigation, event);
    }
  };
  return (
    <tr {...callRowInteraction(inStack, hasChildren, expanded, activate)}>
      <td className="cd-namespace-column">
        <NamespaceBadge name={event.namespace ?? 'unknown'} />
      </td>
      <td className="cd-trace-name-column">
        <div className="cd-tree-function">
          {inStack && (
            <TreeGuides
              event={event}
              expanded={expanded}
              hasVisibleChildren={hasVisibleChildren}
              nextSiblings={nextSiblings}
            />
          )}
          {hasChildren && inStack ? (
            <button
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} children of ${event.name} #${event.id}`}
              className="cd-tree-toggle"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
            >
              <DashboardIcon name={expanded ? 'caret-down' : 'caret-right'} />
            </button>
          ) : (
            <span className="cd-tree-spacer" hidden={!inStack} />
          )}
          <div className="cd-function-name cd-function-inline">
            <TraceKindIcon kind={event.kind} />
            <strong title={event.name}>{event.name}</strong>
            <small>#{event.id}</small>
          </div>
        </div>
      </td>
      <td>
        <span className={`cd-event-status is-${eventStatus(event)}`}>
          {eventStatus(event)}
        </span>
      </td>
      <td>{formatDuration(event.at)}</td>
      <td>{formatDuration(event.duration)}</td>
      <td>
        <div className="cd-row-actions">
          <button
            aria-label={`Inspect frame ${event.id}: ${event.name}`}
            className="cd-icon-button"
            onClick={(e) => {
              e.stopPropagation();
              inspect();
            }}
            title="Inspect call"
          >
            <DashboardIcon name="package" />
          </button>
          {(hasRecordedChildren || !inStack) && (
            <button
              aria-label={`Drill into ${event.name} #${event.id}`}
              className="cd-icon-button"
              onClick={(e) => {
                e.stopPropagation();
                drilldown(navigation, event);
              }}
              title="Drill into this call"
            >
              <DashboardIcon name="arrow-up-right" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function eventStatus(event: FrameItem) {
  return event.status || (event.kind === 'marker' ? 'ok' : event.kind);
}

function rowHint(parent?: number) {
  return parent !== undefined
    ? 'Click a row to expand or collapse children. Use the inspect button to view call details.'
    : 'Click a call to explore its stack. Use the inspect button to view call details.';
}
