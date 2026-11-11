import type { ReactNode } from 'react';

export function TableLoader({
  children,
  columns,
  error,
  label,
  loading,
}: {
  children: ReactNode;
  columns: number;
  error?: string;
  label: string;
  loading: boolean;
}) {
  if (error) {
    return (
      <tr className="cd-table-placeholder-row">
        <td className="cd-table-loading-cell" colSpan={columns}>
          <div className="cd-table-loading" role="alert">
            {error}
          </div>
        </td>
      </tr>
    );
  }
  if (!loading) {
    return children;
  }
  return (
    <tr className="cd-table-placeholder-row">
      <td className="cd-table-loading-cell" colSpan={columns}>
        <div aria-label={label} className="cd-table-loading" role="status">
          <span aria-hidden="true" className="cd-spinner" />
        </div>
      </td>
    </tr>
  );
}
