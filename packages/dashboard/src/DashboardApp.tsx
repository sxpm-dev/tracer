import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { LocalRecordingSummary, TraceRecording } from './types';

import { analyzeCoreRecording, type CoreAnalysis } from './coreAnalysis';
import {
  type CoreDashboardExtensions,
  CoreRecordingDashboard,
  DashboardSidebar,
} from './CoreRecordingDashboard';
import { DashboardShell } from './DashboardShell';
import { InspectorDrawer } from './InspectorDrawer';
import {
  type DashboardNavigation,
  type DashboardRoute,
  useDashboardRoute,
} from './navigation';
import { PerformanceReportBuilder } from './PerformanceReportBuilder';
import { PreparationStatus } from './PreparationStatus';
import {
  createRecordingClient,
  parseRecording,
  parseRecordingJsonl,
} from './recording';
import { createSampleRecording } from './sampleRecording';
import { createSessionClient, type SessionSummary } from './sessionData';
import { SessionsHome } from './SessionsHome';
import {
  createSnapshotClient,
  createStandaloneSnapshot,
  downloadStandaloneHtml,
  readStandaloneSnapshot,
  snapshotSummary,
  snapshotTheme,
  snapshotView,
  type StandaloneSnapshot,
} from './standalone';
import { useDashboardTheme } from './theme';
import { useResource } from './useResource';

export interface DashboardAppProps {
  /** Compact, JSON-serializable data for every host extension page in an offline export. */
  exportData?: (
    recording: TraceRecording,
    summary: SessionSummary | undefined,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>;
  /** Saved sessions provide metadata only. Use useDashboard().loadRecording for full data. */
  extensions?:
    | ((recording: TraceRecording) => CoreDashboardExtensions)
    | CoreDashboardExtensions;
  initialRecording?: TraceRecording;
  /** Share the embedded snapshot with a host that has already read it. */
  initialSnapshot?: StandaloneSnapshot;
  /** Observe URL state to load consumer-owned, filtered projections. */
  onRouteChange?: (route: DashboardRoute) => void;
  sampleRecording?: typeof createSampleRecording;
  serverUrl?: string;
}
function embeddedRecording(): null | TraceRecording {
  const element =
    typeof document === 'undefined'
      ? null
      : document.getElementById('trace-data');
  if (!element?.textContent) {
    return null;
  }
  return parseRecording(element.textContent);
}
const home: DashboardRoute = { kind: 'home', view: { page: 'overview' } };
interface ComparisonMetrics {
  blocking: number;
  calls: number;
  duration: number;
  errors: number;
  title: string;
}
function metrics(
  recording: TraceRecording,
  analysis: CoreAnalysis,
): ComparisonMetrics {
  return {
    blocking: analysis.blockingTotal,
    calls: analysis.calls,
    duration: recording.duration,
    errors: analysis.errors,
    title: recording.title || recording.sessionId,
  };
}
function sampleForRoute(
  route: DashboardRoute,
  create: typeof createSampleRecording,
) {
  return route.kind === 'sample'
    ? create(route.sessionId === 'light' ? 'light' : 'full')
    : null;
}

export function DashboardApp({
  exportData,
  extensions,
  initialRecording,
  initialSnapshot,
  onRouteChange,
  sampleRecording,
  serverUrl = '',
}: DashboardAppProps) {
  const [snapshot] = useState(
    () => initialSnapshot ?? readStandaloneSnapshot(),
  );
  const [local, setLocal] = useState<null | TraceRecording>(() =>
    initialLocalRecording(initialRecording, snapshot),
  );
  const { href, navigate, route } = useDashboardRoute(Boolean(local));
  useEffect(() => onRouteChange?.(route), [onRouteChange, route]);
  const sample = useMemo(
    () => sampleForRoute(route, sampleRecording ?? createSampleRecording),
    [route.kind, route.sessionId, sampleRecording],
  );
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [baseline, setBaseline] = useState<ComparisonMetrics>();
  useEffect(() => {
    if (route.kind === 'home') {
      setLocal(null);
    }
  }, [route.kind]);
  const onHome = () => {
    if (snapshot) {
      navigate({ kind: 'local', view: { page: 'overview' } });
      return;
    }
    setLocal(null);
    navigate(home);
  };
  const onCompare = (value: ComparisonMetrics) => {
    setBaseline(value);
    onHome();
  };
  const openReport = (sessions: Pick<LocalRecordingSummary, 'sessionId'>[]) => {
    navigate({
      kind: 'report',
      sessionIds: sessions.map((session) => session.sessionId),
      view: { page: 'overview' },
    });
  };
  const readFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > 32 * 1024 * 1024) {
      setError(
        'This recording is too large to import into browser memory. Place it in the server recordings directory and open it from Sessions.',
      );
      return;
    }
    setError('');
    void file
      .text()
      .then((text) => {
        let parsed: TraceRecording;
        try {
          parsed = parseRecording(text);
        } catch {
          parsed = parseRecordingJsonl(text);
        }
        setLocal(parsed);
        navigate({ kind: 'local', view: { page: 'overview' } });
      })
      .catch((failure: unknown) => setError(String(failure)));
    event.target.value = '';
  };
  const navigation: DashboardNavigation = {
    href: (view) => href({ ...route, view }),
    onChange: (view, replace) => navigate({ ...route, view }, replace),
    state: route.view,
  };
  const shared = {
    baseline,
    exportData,
    extensions,
    navigation,
    onClearComparison: () => setBaseline(undefined),
    onCompare,
    onHome,
    onReport: (
      session: Pick<LocalRecordingSummary, 'mode' | 'sessionId' | 'title'>,
    ) => openReport([session]),
    serverUrl,
  };
  return (
    <>
      {error && (
        <div className="cd-app-notice" role="alert">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {route.kind === 'home' && (
        <>
          {baseline && (
            <div className="cd-app-notice">
              Select a candidate to compare with{' '}
              <strong>{baseline.title}</strong>.
              <button onClick={() => setBaseline(undefined)}>
                Cancel comparison
              </button>
            </div>
          )}
          <SessionList
            href={href}
            onFile={readFile}
            onOpen={navigate}
            onRefresh={() => setRevision(revision + 1)}
            onReport={openReport}
            revision={revision}
            serverUrl={serverUrl}
          />
        </>
      )}
      {route.kind === 'session' && (
        <SavedSession
          {...shared}
          key={route.sessionId}
          sessionId={route.sessionId!}
        />
      )}
      <ReportRoute onBack={onHome} route={route} serverUrl={serverUrl} />
      {sample && (
        <RecordingView
          {...shared}
          onRefresh={() => undefined}
          recording={sample}
        />
      )}
      {route.kind === 'local' &&
        (local ? (
          <RecordingView
            {...shared}
            onRefresh={() => undefined}
            recording={local}
            snapshot={snapshot}
            summary={snapshotSummary(snapshot)}
          />
        ) : (
          <AppMessage onHome={onHome} title="Reopen the imported recording">
            <p>
              Imported files stay in this tab only. Select the file again to
              continue.
            </p>
            <input
              accept=".json,.jsonl"
              aria-label="Reopen recording"
              onChange={readFile}
              type="file"
            />
          </AppMessage>
        ))}
      {route.kind === 'missing' && (
        <AppMessage onHome={onHome} title="Page not found">
          <p>Return to your recorded sessions.</p>
        </AppMessage>
      )}
    </>
  );
}
function ReportRoute({
  onBack,
  route,
  serverUrl,
}: {
  onBack: () => void;
  route: DashboardRoute;
  serverUrl: string;
}) {
  return route.kind === 'report' ? (
    <ReportPage
      onBack={onBack}
      serverUrl={serverUrl}
      sessionIds={route.sessionIds ?? []}
    />
  ) : null;
}
function ReportPage({
  onBack,
  serverUrl,
  sessionIds,
}: {
  onBack: () => void;
  serverUrl: string;
  sessionIds: string[];
}) {
  const recordings = useResource(`${serverUrl}:report-recordings`, (signal) =>
    createRecordingClient(serverUrl).list(signal),
  );
  const sessions = useMemo(
    () =>
      sessionIds.map(
        (id) =>
          recordings.data?.find((item) => item.sessionId === id) ?? {
            mode: 'full' as const,
            sessionId: id,
            title: id,
          },
      ),
    [recordings.data, sessionIds],
  );
  if (recordings.error) {
    return (
      <AppMessage onHome={onBack} title="Could not load report recordings">
        <p role="alert">{recordings.error}</p>
      </AppMessage>
    );
  }
  if (!recordings.data) {
    return (
      <AppMessage onHome={onBack} title="Preparing report…">
        <p role="status">Loading selected recordings.</p>
      </AppMessage>
    );
  }
  return (
    <PerformanceReportBuilder
      initialSessions={sessions}
      onBack={onBack}
      serverUrl={serverUrl}
    />
  );
}
function SessionList({
  revision,
  serverUrl,
  ...props
}: Omit<
  Parameters<typeof SessionsHome>[0],
  'error' | 'loading' | 'sessions'
> & { revision: number; serverUrl: string }) {
  const sessions = useResource(`${serverUrl}:${revision}`, (signal) =>
    createRecordingClient(serverUrl).list(signal),
  );
  return (
    <SessionsHome
      serverUrl={serverUrl}
      {...props}
      error={sessions.error}
      loading={!sessions.data && !sessions.error}
      sessions={sessions.data}
    />
  );
}
interface ViewProps {
  baseline?: ComparisonMetrics;
  exportData?: DashboardAppProps['exportData'];
  extensions?: DashboardAppProps['extensions'];
  navigation: DashboardNavigation;
  onClearComparison: () => void;
  onCompare: (value: ComparisonMetrics) => void;
  onHome: () => void;
  onReport: (
    session: Pick<LocalRecordingSummary, 'mode' | 'sessionId' | 'title'>,
  ) => void;
  serverUrl: string;
}
function SavedSession(props: ViewProps & { sessionId: string }) {
  const [revision, setRevision] = useState(0);
  const client = useMemo(
    () => createSessionClient(props.serverUrl),
    [props.serverUrl],
  );
  const root =
    props.navigation.state.page === 'functions'
      ? (props.navigation.state.root ?? '')
      : '';
  const summary = useResource(
    `${props.serverUrl}:${props.sessionId}:${revision}`,
    (signal) => client.summary(props.sessionId, '', signal),
  );
  const filtered = useResource(
    `${props.serverUrl}:${props.sessionId}:${root}:${revision}`,
    (signal) =>
      root
        ? client.summary(props.sessionId, root, signal)
        : Promise.resolve(undefined),
  );
  if (filtered.error) {
    return (
      <AppMessage onHome={props.onHome} title="Could not filter this session">
        <p role="alert">{filtered.error}</p>
        <button className="cd-button" onClick={() => setRevision(revision + 1)}>
          Try again
        </button>
      </AppMessage>
    );
  }
  if (summary.error) {
    return (
      <AppMessage onHome={props.onHome} title="Could not open this session">
        <p role="alert">{summary.error}</p>
        <button className="cd-button" onClick={() => setRevision(revision + 1)}>
          Try again
        </button>
      </AppMessage>
    );
  }
  if (!summary.data || (root && !filtered.data)) {
    return (
      <AppMessage onHome={props.onHome} title="Preparing session analytics…">
        <PreparationStatus client={client} sessionId={props.sessionId} />
        <p role="status">
          Preparing charts and the search index. The first visit to a large
          recording takes longer; later visits reuse the index.
        </p>
      </AppMessage>
    );
  }
  return (
    <RecordingView
      {...props}
      functionAnalysis={filtered.data?.analysis}
      key={revision}
      onRefresh={() => setRevision(revision + 1)}
      recording={summary.data.recording}
      summary={summary.data}
    />
  );
}
function RecordingView({
  functionAnalysis,
  onRefresh,
  recording,
  snapshot,
  summary,
  ...props
}: ViewProps & {
  functionAnalysis?: CoreAnalysis;
  onRefresh: () => void;
  recording: TraceRecording;
  snapshot?: StandaloneSnapshot;
  summary?: SessionSummary;
}) {
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportPhase, setExportPhase] = useState('Preparing dashboard');
  const operation = useRef<AbortController>();
  useEffect(() => () => operation.current?.abort(), []);
  const client = useMemo(
    () =>
      snapshot
        ? createSnapshotClient(snapshot)
        : createSessionClient(props.serverUrl),
    [props.serverUrl, snapshot],
  );
  const analysis = useMemo(
    () => summary?.analysis ?? analyzeCoreRecording(recording),
    [recording, summary],
  );
  const custom =
    typeof props.extensions === 'function'
      ? props.extensions(recording)
      : props.extensions;
  const loadRecording = (signal?: AbortSignal) =>
    summary
      ? loadBoundedRecording(props.serverUrl, recording.sessionId, signal)
      : Promise.resolve(recording);
  const exportHtml = async () => {
    setExporting(true);
    setExportProgress(0);
    setExportPhase('Preparing dashboard');
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const exported =
        snapshot ??
        (await createStandaloneSnapshot(recording, {
          client: summary ? client : undefined,
          onProgress: (progress) => setExportProgress(progress * 0.9),
          signal: controller.signal,
          summary,
          view: props.navigation.state,
        }));
      controller.signal.throwIfAborted();
      setExportPhase('Preparing extension data');
      setExportProgress(0.9);
      const extensions =
        snapshot?.extensions ??
        (await props.exportData?.(recording, summary, controller.signal));
      controller.signal.throwIfAborted();
      setExportPhase('Packaging HTML');
      setExportProgress(0.97);
      await downloadStandaloneHtml(
        recording,
        undefined,
        {
          ...exported,
          extensions,
          theme: snapshotTheme(),
          view: snapshotView(props.navigation.state),
        },
        controller.signal,
      );
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(String(failure));
      }
    } finally {
      if (!controller.signal.aborted) {
        setExporting(false);
      }
    }
  };
  return (
    <>
      {error && (
        <div className="cd-app-notice" role="alert">
          {error}
        </div>
      )}
      {props.baseline && (
        <Comparison
          baseline={props.baseline}
          candidate={metrics(recording, analysis)}
          onClose={props.onClearComparison}
        />
      )}
      <CoreRecordingDashboard
        extensions={{
          ...custom,
          toolbarActions: (
            <>
              {custom?.toolbarActions}
              <ReportToolbarAction
                enabled={Boolean(summary)}
                onReport={props.onReport}
                recording={recording}
                snapshot={snapshot}
              />
              <button
                className="cd-button"
                disabled={exporting}
                onClick={() => void exportHtml()}
              >
                {exporting
                  ? exportLabel(exportPhase, exportProgress)
                  : 'Export HTML'}
              </button>
              <CancelExport
                exporting={exporting}
                onCancel={() => {
                  operation.current?.abort();
                  setExporting(false);
                }}
              />
            </>
          ),
        }}
        functionAnalysis={
          snapshot
            ? snapshot.scopes.find(
                (scope) => scope.root === (props.navigation.state.root ?? ''),
              )?.analysis
            : functionAnalysis
        }
        loadRecording={snapshot ? undefined : loadRecording}
        navigation={props.navigation}
        onCompare={() => props.onCompare(metrics(recording, analysis))}
        onOpen={props.onHome}
        onRefresh={onRefresh}
        rawRecordingUrl={recordingDownloadUrl(
          props.serverUrl,
          recording.sessionId,
          summary,
          snapshot,
        )}
        recording={recording}
        sessionClient={summary ? client : undefined}
        summary={summary}
      />
    </>
  );
}
function ReportToolbarAction({
  enabled,
  onReport,
  recording,
  snapshot,
}: {
  enabled: boolean;
  onReport: ViewProps['onReport'];
  recording: TraceRecording;
  snapshot?: StandaloneSnapshot;
}) {
  if (!enabled || snapshot) {
    return null;
  }
  return (
    <button
      className="cd-button"
      onClick={() =>
        onReport({
          mode: recording.mode,
          sessionId: recording.sessionId,
          title: recording.title ?? recording.sessionId,
        })
      }
    >
      Create performance report
    </button>
  );
}
function AppMessage({
  children,
  onHome,
  title,
}: {
  children: React.ReactNode;
  onHome: () => void;
  title: string;
}) {
  const { theme, toggleTheme } = useDashboardTheme();
  return (
    <DashboardShell
      sidebar={
        <DashboardSidebar
          findings={0}
          navigation={[]}
          onHome={onHome}
          onSection={() => undefined}
          onTheme={toggleTheme}
          section="sessions"
          theme={theme}
        />
      }
      theme={theme}
      toolbar={
        <header className="cd-toolbar">
          <div className="cd-breadcrumb">Trace workspace</div>
          <button className="cd-button" onClick={onHome}>
            All sessions
          </button>
        </header>
      }
    >
      <section className="cd-card cd-app-message">
        <span className="cd-eyebrow">TRACE WORKSPACE</span>
        <h1>{title}</h1>
        {children}
      </section>
    </DashboardShell>
  );
}
function Comparison({
  baseline,
  candidate,
  onClose,
}: {
  baseline: ComparisonMetrics;
  candidate: ComparisonMetrics;
  onClose: () => void;
}) {
  const rate = (item: ComparisonMetrics) =>
    item.duration > 0
      ? ((item.calls * 1000) / item.duration).toFixed(1)
      : 'Unavailable';
  return (
    <InspectorDrawer
      onClose={onClose}
      subtitle="Equivalent interactions give the most useful comparison"
      title="Compare sessions"
    >
      <div className="cd-card">
        <h2>
          {baseline.title} → {candidate.title}
        </h2>
        <p>
          Compare equivalent interactions; inclusive call time includes nested
          work.
        </p>
        <div className="cd-table-scroll">
          <table className="cd-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Candidate</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Function calls / second</td>
                <td>{rate(baseline)}</td>
                <td>{rate(candidate)}</td>
              </tr>
              <tr>
                <td>Errors</td>
                <td>{baseline.errors}</td>
                <td>{candidate.errors}</td>
              </tr>
              <tr>
                <td>Main-thread blocking (ms)</td>
                <td>{baseline.blocking.toFixed(1)}</td>
                <td>{candidate.blocking.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <button className="cd-button" onClick={onClose}>
          Close comparison
        </button>
      </div>
    </InspectorDrawer>
  );
}

function initialLocalRecording(
  recording?: TraceRecording,
  snapshot?: StandaloneSnapshot,
) {
  return recording ?? snapshot?.summary.recording ?? embeddedRecording();
}

async function loadBoundedRecording(
  serverUrl: string,
  sessionId: string,
  signal?: AbortSignal,
) {
  const client = createRecordingClient(serverUrl);
  const metadata = (await client.list(signal)).find(
    (item) => item.sessionId === sessionId,
  );
  if (metadata && metadata.bytes > 32 * 1024 * 1024) {
    throw new Error(
      'This recording is too large to load into browser memory. Use the paged dashboard or Export HTML to share summaries without raw traces.',
    );
  }
  return client.load(sessionId, undefined, signal);
}

function recordingDownloadUrl(
  serverUrl: string,
  id: string,
  summary?: SessionSummary,
  snapshot?: StandaloneSnapshot,
) {
  return summary && !snapshot
    ? new URL(
        `${serverUrl.replace(/\/$/, '')}/api/recordings/${encodeURIComponent(id)}`,
        window.location.href,
      ).href
    : undefined;
}

function exportLabel(phase: string, progress: number) {
  return progress > 0
    ? `${phase}… ${Math.round(progress * 100)}%`
    : `${phase}…`;
}

function CancelExport({
  exporting,
  onCancel,
}: {
  exporting: boolean;
  onCancel: () => void;
}) {
  return exporting ? (
    <button className="cd-button" onClick={onCancel} type="button">
      Cancel export
    </button>
  ) : null;
}
