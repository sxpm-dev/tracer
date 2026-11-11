import { useState } from 'react';

import type { CoreFunctionStat } from './coreAnalysis';
import type { DashboardNavigation } from './navigation';

import { DashboardIcon } from './DashboardIcon';
import { explorerQuery, useCallAnalytics } from './ExplorerTimeline';
import { NamespaceBadge } from './NamespaceBadge';
import { formatDuration } from './recording';
import { PageControls } from './RemoteFrames';
import { rowAction } from './rowAction';
import { SESSION_PAGE_SIZE } from './sessionData';
import { TableLoader } from './TableLoader';
import { TraceKindIcon } from './TraceKindIcon';

type Sort =
  | 'average'
  | 'calls'
  | 'errors'
  | 'maxDuration'
  | 'name'
  | 'namespace'
  | 'totalDuration';
function numericValue(
  item: CoreFunctionStat,
  sort: Exclude<Sort, 'name' | 'namespace'>,
) {
  return sort === 'average'
    ? item.totalDuration / Math.max(1, item.calls)
    : item[sort];
}
export function RootTraceGroups({
  navigation,
}: {
  navigation: DashboardNavigation;
}) {
  const resource = useCallAnalytics({
    ...explorerQuery(navigation.state),
    maxDuration: undefined,
    minDuration: undefined,
    rootsOnly: true,
  });
  const [sort, setSort] = useState<Sort>('calls');
  const [ascending, setAscending] = useState(false);
  const offset = navigation.state.frameOffset ?? 0;
  const items = [...(resource.data?.functions ?? [])].sort((a, b) => {
    const order =
      sort === 'name' || sort === 'namespace'
        ? `${a[sort]}.${a.namespace}.${a.name}`.localeCompare(
            `${b[sort]}.${b.namespace}.${b.name}`,
          )
        : numericValue(a, sort) - numericValue(b, sort);
    return ascending ? order : -order;
  });
  const open = (item: CoreFunctionStat) =>
    navigation.onChange({
      ...navigation.state,
      frameOffset: 0,
      functionId: `${item.namespace}\0${item.name}`,
      page: 'frames',
      tree: 'roots',
    });
  return (
    <section className="cd-card cd-frame-table">
      <div className="cd-card-heading">
        <div>
          <span className="cd-eyebrow">TRACE EXPLORER</span>
          <h2>Root traces by function</h2>
          <p>Select a function to explore its individual root calls.</p>
        </div>
        <span className="cd-count-pill">
          {resource.data?.functions.length ?? '…'} functions
        </span>
      </div>
      <div className="cd-table-scroll">
        <table className="cd-table">
          <thead>
            <tr>
              {(
                [
                  ['namespace', 'Namespace'],
                  ['name', 'Function'],
                  ['calls', 'Calls'],
                  ['totalDuration', 'Total'],
                  ['maxDuration', 'Max'],
                  ['average', 'Avg'],
                  ['errors', 'Errors'],
                ] as const
              ).map(([key, label]) => (
                <th
                  aria-sort={
                    sort === key
                      ? ascending
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  className={
                    key === 'name' ? 'cd-trace-name-column' : undefined
                  }
                  key={key}
                >
                  <button
                    className="cd-sort-heading"
                    onClick={() => {
                      setSort(key);
                      setAscending(sort === key ? !ascending : false);
                      navigation.onChange({
                        ...navigation.state,
                        frameOffset: 0,
                      });
                    }}
                  >
                    {label}
                    <DashboardIcon
                      name={
                        sort === key
                          ? ascending
                            ? 'arrow-up'
                            : 'arrow-down'
                          : 'sort'
                      }
                      size={12}
                    />
                  </button>
                </th>
              ))}
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            <TableLoader
              columns={8}
              error={resource.error}
              label="Loading root functions"
              loading={!resource.data}
            >
              {items.slice(offset, offset + SESSION_PAGE_SIZE).map((item) => (
                <tr
                  key={`${item.namespace}\0${item.name}`}
                  {...rowAction(() => open(item))}
                  className="cd-clickable-row"
                >
                  <td className="cd-namespace-column">
                    <NamespaceBadge name={item.namespace} />
                  </td>
                  <td className="cd-trace-name-column">
                    <div className="cd-function-name cd-function-inline">
                      <TraceKindIcon kind="call" />
                      <strong>{item.name}</strong>
                    </div>
                  </td>
                  <td>{item.calls.toLocaleString()}</td>
                  <td>{formatDuration(item.totalDuration)}</td>
                  <td>{formatDuration(item.maxDuration)}</td>
                  <td>{formatDuration(numericValue(item, 'average'))}</td>
                  <td>{item.errors.toLocaleString()}</td>
                  <td>
                    <button
                      aria-label={`Explore root calls to ${item.namespace}.${item.name}`}
                      className="cd-icon-button"
                      onClick={() => open(item)}
                    >
                      <DashboardIcon name="arrow-up-right" />
                    </button>
                  </td>
                </tr>
              ))}
            </TableLoader>
          </tbody>
        </table>
      </div>
      {resource.data && !items.length && (
        <p className="cd-browser-empty">
          No root functions match these filters.
        </p>
      )}
      {resource.data && (
        <PageControls
          offset={offset}
          onChange={(frameOffset) =>
            navigation.onChange({ ...navigation.state, frameOffset })
          }
          total={items.length}
        />
      )}
    </section>
  );
}
