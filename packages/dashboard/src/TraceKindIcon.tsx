import type { TraceEvent } from './types';

import { DashboardIcon } from './DashboardIcon';

export function TraceKindIcon({ kind }: { kind: TraceEvent['kind'] }) {
  return (
    <span
      className={`cd-trace-kind is-${kind}`}
      title={kind === 'marker' ? 'Marker' : 'Function'}
    >
      <DashboardIcon
        name={kind === 'marker' ? 'bookmark-simple' : 'functions'}
        size={16}
      />
    </span>
  );
}
