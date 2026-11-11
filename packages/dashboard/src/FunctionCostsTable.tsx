import type { ReactNode } from 'react';

import type { CoreFunctionStat } from './coreAnalysis';

import { functionKey } from './coreAnalysis';
import { NamespaceBadge } from './NamespaceBadge';
import { formatDuration } from './recording';
import { rowAction } from './rowAction';
import { TableLoader } from './TableLoader';
import { TraceKindIcon } from './TraceKindIcon';

interface ExtensionColumn {
  id: string;
  render: (item: CoreFunctionStat) => ReactNode;
}

export function FunctionCostsTable({
  columns = [],
  error,
  extensionHeadings,
  headings,
  items,
  loading = false,
  onInspect,
  renderAction,
  selected,
}: {
  columns?: ExtensionColumn[];
  error?: string;
  extensionHeadings?: ReactNode;
  headings?: ReactNode;
  items: CoreFunctionStat[];
  loading?: boolean;
  onInspect: (item: CoreFunctionStat) => void;
  renderAction: (item: CoreFunctionStat) => ReactNode;
  selected?: string;
}) {
  return (
    <div className="cd-table-scroll">
      <table className="cd-table">
        <thead>
          <tr>
            <th className="cd-namespace-column">Namespace</th>
            <th className="cd-trace-name-column">Function</th>
            {headings ?? (
              <>
                <th>Calls</th>
                <th>Average</th>
                <th>Total</th>
                <th>Slowest</th>
                <th>Errors</th>
              </>
            )}
            {extensionHeadings}
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          <TableLoader
            columns={8 + columns.length}
            error={error}
            label="Loading functions"
            loading={loading}
          >
            {items.map((item) => (
              <tr
                {...rowAction(() => onInspect(item))}
                className={
                  selected === functionKey(item.namespace, item.name)
                    ? 'cd-selected cd-clickable-row'
                    : 'cd-clickable-row'
                }
                key={functionKey(item.namespace, item.name)}
              >
                <td className="cd-namespace-column">
                  <NamespaceBadge name={item.namespace} />
                </td>
                <td className="cd-trace-name-column">
                  <button
                    aria-label={`Inspect ${item.namespace}.${item.name}`}
                    className="cd-function-name cd-function-inline"
                    onClick={() => onInspect(item)}
                    type="button"
                  >
                    <TraceKindIcon kind="call" />
                    <strong title={item.name}>{item.name}</strong>
                  </button>
                </td>
                <td>{item.calls.toLocaleString()}</td>
                <td>
                  {formatDuration(item.totalDuration / Math.max(item.calls, 1))}
                </td>
                <td>{formatDuration(item.totalDuration)}</td>
                <td>
                  {Number.isFinite(item.maxDuration)
                    ? formatDuration(item.maxDuration)
                    : '—'}
                </td>
                <td>
                  {Number.isFinite(item.errors)
                    ? item.errors.toLocaleString()
                    : '—'}
                </td>
                {columns.map((column) => (
                  <td key={column.id}>{column.render(item)}</td>
                ))}
                <td>{renderAction(item)}</td>
              </tr>
            ))}
          </TableLoader>
        </tbody>
      </table>
    </div>
  );
}
