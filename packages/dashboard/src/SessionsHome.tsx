import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import type { DashboardRoute } from './navigation';
import type { LocalRecordingSummary } from './types';

import { DashboardSidebar } from './CoreRecordingDashboard';
import { DashboardIcon } from './DashboardIcon';
import { DashboardShell } from './DashboardShell';
import { createRecordingClient, formatDuration } from './recording';
import { SearchableSelect } from './SearchableSelect';
import { useDashboardTheme } from './theme';

function captureLabel(mode: LocalRecordingSummary['mode']): string {
  return mode === 'browser' ? 'Browser' : mode === 'light' ? 'Light' : 'Full';
}

function sessionActivity(session: LocalRecordingSummary): string {
  if (session.mode === 'browser') {
    return `${(session.browserSampleCount ?? 0).toLocaleString()} samples`;
  }
  if (session.mode === 'light') {
    return `${(session.aggregateCallCount ?? 0).toLocaleString()} calls`;
  }
  return `${session.eventCount.toLocaleString()} events`;
}

export function SessionsHome({
  error,
  href,
  loading,
  onFile,
  onOpen,
  onRefresh,
  onReport,
  serverUrl,
  sessions = [],
}: {
  error?: string;
  href: (route: DashboardRoute) => string;
  loading: boolean;
  onFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onOpen: (route: DashboardRoute) => void;
  onRefresh: () => void;
  onReport?: (sessions: LocalRecordingSummary[]) => void;
  serverUrl?: string;
  sessions?: LocalRecordingSummary[];
}) {
  const { appearanceLabel, theme, toggleTheme } = useDashboardTheme();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [mode, setMode] = useState('all');
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState('recent');
  const [direction, setDirection] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const all = sessions;
  const matches = all
    .filter((session) => matchesSession(session, query, status, mode))
    .sort((a, b) => sessionOrder(a, b, order) * direction);
  const ready = !loading && !error;
  const pageCount = Math.ceil(matches.length / 20);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  return (
    <DashboardShell
      sidebar={
        <DashboardSidebar
          findings={0}
          navigation={[]}
          onHome={() => undefined}
          onSection={() => undefined}
          onTheme={toggleTheme}
          section="sessions"
          theme={theme}
        />
      }
      theme={theme}
      toolbar={
        <header className="cd-toolbar">
          <div className="cd-breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>Sessions</strong>
          </div>{' '}
          <div className="cd-toolbar-actions">
            <button className="cd-button" onClick={toggleTheme}>
              {appearanceLabel}
            </button>
            <label className="cd-button cd-file-button">
              Import recording
              <input
                accept=".json,.jsonl"
                aria-label="Import recording"
                onChange={onFile}
                type="file"
              />
            </label>
            <button
              className="cd-button"
              disabled={loading}
              onClick={onRefresh}
            >
              Refresh sessions
            </button>
          </div>
        </header>
      }
    >
      <div className="cd-page-heading">
        <div>
          <span className="cd-kicker">YOUR WORKSPACE</span>
          <h1>Recorded sessions</h1>
          <p>Find a recording. Understand the work behind every interaction.</p>
        </div>
        <div className="cd-toolbar-actions">
          <span className="cd-count-pill">{all.length} sessions</span>
          <DeleteAllRecordings
            onRefresh={onRefresh}
            ready={ready}
            serverUrl={serverUrl}
            sessions={all}
          />
        </div>
      </div>
      <section className="cd-card cd-sample-intro">
        <div>
          <strong>Explore with sample data</strong>
          <p>
            Synthetic recordings with runtime signals, nested calls, arguments,
            errors, and metadata. No capture setup required.
          </p>
        </div>
        <div className="cd-toolbar-actions">
          <a
            className="cd-button primary"
            href={href({
              kind: 'sample',
              sessionId: 'full',
              view: { page: 'overview' },
            })}
          >
            Open sample data
          </a>
          <a
            className="cd-button"
            href={href({
              kind: 'sample',
              sessionId: 'light',
              view: { page: 'overview' },
            })}
          >
            Lightweight sample
          </a>
        </div>
      </section>
      <div className="cd-metrics cd-session-metrics">
        <div className="cd-card cd-metric">
          <span>Recorded sessions</span>
          <strong>
            {all.filter((item) => item.status === 'complete').length}
          </strong>
          <small>Ready to explore</small>
        </div>
        <div className="cd-card cd-metric">
          <span>Recording now</span>
          <strong>
            {all.filter((item) => item.status === 'recording').length}
          </strong>
          <small>Refresh to see the latest data</small>
        </div>
        <div className="cd-card cd-metric">
          <span>Stored recordings</span>
          <strong>
            {formatBytes(all.reduce((sum, item) => sum + item.bytes, 0))}
          </strong>
          <small>Details load as you explore</small>
        </div>
      </div>
      <section
        aria-label="Saved recordings"
        className="cd-card cd-sessions-list"
      >
        <ReportSelectionButton
          onClear={() => setSelected([])}
          onReport={onReport}
          selected={selected}
          sessions={all}
        />
        <div className="cd-function-controls">
          <label className="cd-search">
            <span>Search sessions</span>
            <input
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Title or session ID"
              type="search"
              value={query}
            />
          </label>
          <SearchableSelect
            label="Status"
            onChange={(value) => {
              setStatus(value);
              setPage(0);
            }}
            options={[
              { label: 'All sessions', value: 'all' },
              { label: 'Completed', value: 'complete' },
              { label: 'Recording', value: 'recording' },
            ]}
            value={status}
          />
          <SearchableSelect
            label="Capture"
            onChange={(value) => {
              setMode(value);
              setPage(0);
            }}
            options={[
              { label: 'All modes', value: 'all' },
              { label: 'Full', value: 'full' },
              { label: 'Light', value: 'light' },
              { label: 'Browser', value: 'browser' },
            ]}
            value={mode}
          />
        </div>
        {error && (
          <div className="cd-empty" role="alert">
            <strong>Could not load sessions</strong>
            <p>{error}</p>
            <button className="cd-button" onClick={onRefresh}>
              Try again
            </button>
          </div>
        )}
        {loading && (
          <div className="cd-empty" role="status">
            Loading saved sessions…
          </div>
        )}
        {ready && matches.length > 0 && (
          <div className="cd-table-scroll">
            <table className="cd-table cd-sessions-table">
              <thead>
                <tr>
                  <ReportSelectionHeader enabled={Boolean(onReport)} />
                  {[
                    ['title', 'Session'],
                    ['recent', 'Recorded'],
                    ['status', 'Status'],
                    ['mode', 'Capture'],
                    ['duration', 'Duration'],
                    ['events', 'Captured'],
                    ['size', 'Size'],
                  ].map(([key, label]) => (
                    <th
                      aria-sort={
                        order === key
                          ? direction === 1
                            ? 'descending'
                            : 'ascending'
                          : 'none'
                      }
                      key={key}
                    >
                      <button
                        className="cd-sort-heading"
                        onClick={() => {
                          setOrder(key);
                          setDirection(order === key ? -direction : 1);
                          setPage(0);
                        }}
                      >
                        {label}
                        <DashboardIcon
                          name={
                            order === key
                              ? direction === 1
                                ? 'arrow-down'
                                : 'arrow-up'
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
                {matches
                  .slice(currentPage * 20, (currentPage + 1) * 20)
                  .map((session) => {
                    const route: DashboardRoute = {
                      kind: 'session',
                      sessionId: session.sessionId,
                      view: { page: 'overview' },
                    };
                    return (
                      <tr
                        className="cd-clickable-row"
                        key={session.sessionId}
                        onClick={(event) => {
                          if (
                            !(event.target as HTMLElement).closest(
                              'a,button,details,input',
                            )
                          ) {
                            onOpen(route);
                          }
                        }}
                      >
                        <ReportSelectionCell
                          enabled={Boolean(onReport)}
                          selected={selected}
                          session={session}
                          setSelected={setSelected}
                        />
                        <td>
                          <a
                            className="cd-session-link"
                            href={href(route)}
                            onClick={(event) => {
                              if (
                                !event.metaKey &&
                                !event.ctrlKey &&
                                !event.shiftKey &&
                                !event.altKey &&
                                event.button === 0
                              ) {
                                event.preventDefault();
                                onOpen(route);
                              }
                            }}
                          >
                            <strong>
                              {session.title || 'Untitled recording'}
                            </strong>
                            <small>{session.sessionId}</small>
                          </a>
                        </td>
                        <td>
                          <time dateTime={session.startedAt}>
                            {new Date(session.startedAt).toLocaleString()}
                          </time>
                        </td>
                        <td>
                          <span
                            className={`cd-session-status is-${session.status}`}
                          >
                            {session.status === 'recording'
                              ? 'Recording'
                              : 'Completed'}
                          </span>
                        </td>
                        <td>{captureLabel(session.mode)}</td>
                        <td>{formatDuration(session.duration)}</td>
                        <td>{sessionActivity(session)}</td>
                        <td>{formatBytes(session.bytes)}</td>
                        <td>
                          <RecordingMenu
                            onRemoved={onRefresh}
                            serverUrl={serverUrl!}
                            session={session}
                          />
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
        {ready && !matches.length && (
          <EmptySessions hasSessions={all.length > 0} />
        )}
        {pageCount > 1 && (
          <div className="cd-pagination">
            <button
              className="cd-button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
            <button
              className="cd-button"
              disabled={currentPage + 1 >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
function ReportSelectionHeader({ enabled }: { enabled: boolean }) {
  return enabled ? <th scope="col">Select</th> : null;
}
function ReportSelectionButton({
  onClear,
  onReport,
  selected,
  sessions,
}: {
  onClear: () => void;
  onReport?: (sessions: LocalRecordingSummary[]) => void;
  selected: string[];
  sessions: LocalRecordingSummary[];
}) {
  const chosen = sessions.filter((item) => selected.includes(item.sessionId));
  if (!onReport || !chosen.length) {
    return null;
  }
  return (
    <div className="cd-report-selection-bar">
      <span>
        <strong>{chosen.length}</strong> recording
        {chosen.length === 1 ? '' : 's'} selected
      </span>
      <div>
        <button className="cd-button" onClick={onClear}>
          Clear selection
        </button>
        <button className="cd-button primary" onClick={() => onReport(chosen)}>
          {chosen.length === 1 ? 'Generate report' : 'Compare in report'}
        </button>
      </div>
    </div>
  );
}
function ReportSelectionCell({
  enabled,
  selected,
  session,
  setSelected,
}: {
  enabled: boolean;
  selected: string[];
  session: LocalRecordingSummary;
  setSelected: (ids: string[]) => void;
}) {
  if (!enabled) {
    return null;
  }
  return (
    <td>
      <input
        aria-label={`Select ${session.title || session.sessionId} for report`}
        checked={selected.includes(session.sessionId)}
        onChange={(event) =>
          setSelected(
            event.target.checked
              ? [...selected, session.sessionId]
              : selected.filter((id) => id !== session.sessionId),
          )
        }
        type="checkbox"
      />
    </td>
  );
}
function DeleteAllRecordings({
  onRefresh,
  ready,
  serverUrl,
  sessions,
}: {
  onRefresh: () => void;
  ready: boolean;
  serverUrl?: string;
  sessions: LocalRecordingSummary[];
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = sessions.filter((session) => session.status !== 'recording');
  const activeCount = sessions.length - saved.length;
  const removeAll = async () => {
    setBusy(true);
    setError('');
    let failures = 0;
    const client = createRecordingClient(serverUrl);
    for (const session of saved) {
      try {
        await client.remove(session.sessionId);
      } catch {
        failures += 1;
      }
    }
    onRefresh();
    setBusy(false);
    if (failures) {
      setError(
        `Could not delete ${failures} recording${failures === 1 ? '' : 's'}.`,
      );
    } else {
      setConfirming(false);
    }
  };
  return (
    <>
      <button
        className="cd-button cd-danger"
        disabled={!ready || saved.length === 0}
        onClick={() => {
          setError('');
          setConfirming(true);
        }}
      >
        Delete saved recordings
      </button>
      {confirming && (
        <DeleteConfirmation
          actionLabel="Delete all saved recordings"
          busy={busy}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void removeAll()}
          title={`Delete ${saved.length} saved recording${saved.length === 1 ? '' : 's'}?`}
        >
          <p>
            This removes their data and search indexes. This cannot be undone.
          </p>
          {activeCount > 0 && (
            <p>
              {activeCount} active recording{activeCount === 1 ? '' : 's'} will
              remain.
            </p>
          )}
        </DeleteConfirmation>
      )}
    </>
  );
}
function matchesSession(
  session: LocalRecordingSummary,
  query: string,
  status: string,
  mode: string,
) {
  return (
    `${session.title} ${session.sessionId}`
      .toLowerCase()
      .includes(query.toLowerCase()) &&
    (status === 'all' || session.status === status) &&
    (mode === 'all' || (session.mode ?? 'full') === mode)
  );
}
function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function EmptySessions({ hasSessions }: { hasSessions: boolean }) {
  return (
    <div className="cd-empty cd-sessions-empty">
      <DashboardIcon name="sessions" size={24} />
      <strong>
        {hasSessions
          ? 'No matching sessions'
          : 'Your recordings will appear here'}
      </strong>
      <p>
        {hasSessions
          ? 'Try another search or capture filter.'
          : 'Start a tracing session in your application, then refresh. You can also import a JSON or JSONL recording.'}
      </p>
    </div>
  );
}

function sessionOrder(
  a: LocalRecordingSummary,
  b: LocalRecordingSummary,
  order: string,
) {
  if (order === 'status' || order === 'mode') {
    return String(b[order]).localeCompare(String(a[order]));
  }
  if (order === 'events') {
    return b.eventCount - a.eventCount;
  }
  if (order === 'size') {
    return b.bytes - a.bytes;
  }
  if (order === 'duration') {
    return (b.duration ?? 0) - (a.duration ?? 0);
  }
  if (order === 'title') {
    return b.title.localeCompare(a.title);
  }
  return b.startedAt.localeCompare(a.startedAt);
}

function RecordingMenu({
  onRemoved,
  serverUrl,
  session,
}: {
  onRemoved: () => void;
  serverUrl: string;
  session: LocalRecordingSummary;
}) {
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menu.current?.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true);
    try {
      await createRecordingClient(serverUrl).remove(session.sessionId);
      setConfirming(false);
      onRemoved();
    } catch (failure) {
      setError(String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cd-recording-menu" onClick={(e) => e.stopPropagation()}>
      <details open={menuOpen} ref={menu}>
        <summary
          aria-label={`Actions for ${session.title}`}
          className="cd-icon-button"
          onClick={(event) => {
            event.preventDefault();
            setMenuOpen((open) => !open);
          }}
        >
          <DashboardIcon name="dots-three" size={20} />
        </summary>
        <button
          className="cd-button"
          onClick={() => {
            setMenuOpen(false);
            setConfirming(true);
          }}
        >
          Delete recording
        </button>
      </details>
      {confirming && (
        <DeleteConfirmation
          actionLabel="Delete recording"
          busy={busy}
          error={error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
          title="Delete recording?"
        >
          <p>{session.title}</p>
          <p>
            This removes the recording and its search index. This cannot be
            undone.
          </p>
          {session.status === 'recording' && (
            <p>
              Later batches and the finish request for this session will be
              ignored.
            </p>
          )}
        </DeleteConfirmation>
      )}
    </div>
  );
}

function DeleteConfirmation({
  actionLabel,
  busy,
  children,
  error,
  onCancel,
  onConfirm,
  title,
}: {
  actionLabel: string;
  busy: boolean;
  children: ReactNode;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  return (
    <div className="cd-confirm-overlay">
      <section
        aria-label={title}
        aria-modal="true"
        className="cd-card"
        role="alertdialog"
      >
        <h2>{title}</h2>
        {children}
        {error && <p role="alert">{error}</p>}
        <div className="cd-confirm-actions">
          <button
            autoFocus
            className="cd-button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="cd-button cd-danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Deleting…' : actionLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
