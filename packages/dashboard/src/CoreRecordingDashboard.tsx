import { type ReactNode, useEffect, useMemo, useState } from 'react';

import type { DashboardNavigation, DashboardViewState } from './navigation';
import type { FrameQuery, SessionClient, SessionSummary } from './sessionData';
import type { TraceEvent, TraceRecording } from './types';

import { AnalyticsChart } from './AnalyticsChart';
import {
  analyzeCoreRecording,
  type CoreAnalysis,
  type CoreFinding,
  type CoreFunctionStat,
  functionKey,
  TIMELINE_BUCKETS,
} from './coreAnalysis';
import {
  CoreBrowserSignals,
  OverviewSliceFunctions,
} from './CoreBrowserSignals';
import { DashboardIcon } from './DashboardIcon';
import { DashboardShell } from './DashboardShell';
import {
  ExplorerFilters,
  ExplorerTimeline,
  useFunctionAnalysis,
} from './ExplorerTimeline';
import {
  DashboardBlock,
  DashboardContextProvider,
  type DashboardCustomization,
  DashboardCustomizationProvider,
  DashboardPage,
  useDashboard,
  validateCustomization,
} from './extensions';
import './core-dashboard.css';
import './workspace.css';
import { FunctionCostsTable } from './FunctionCostsTable';
import { InspectorDrawer } from './InspectorDrawer';
import { secondIndex } from './lightWindowBuckets';
import { createLocalSessionClient } from './localSessionClient';
import { metricColor } from './metricColors';
import { NamespaceBadge } from './NamespaceBadge';
import { formatProblemReportMarkdown } from './problemReport';
import { formatDuration } from './recording';
import { RemoteFrames } from './RemoteFrames';
import { type DashboardTheme as Theme, useDashboardTheme } from './theme';
import { TraceKindIcon } from './TraceKindIcon';
import { useTimelineRange } from './useTimelineRange';

type Section = string;
type SortKey =
  | 'average'
  | 'calls'
  | 'errors'
  | 'maxDuration'
  | 'totalDuration'
  | `extension:${string}`;

export interface CoreFunctionColumn {
  id: string;
  label: string;
  render: (item: CoreFunctionStat) => ReactNode;
  sortValue?: (item: CoreFunctionStat) => number;
}

export interface CoreDashboardExtensions extends DashboardCustomization {
  frameDetails?: (event: TraceEvent) => ReactNode;
  functionColumns?: CoreFunctionColumn[];
  overview?: ReactNode;
  problems?: ReactNode;
  toolbarActions?: ReactNode;
}

interface Props {
  extensions?: CoreDashboardExtensions;
  functionAnalysis?: CoreAnalysis;
  loadRecording?: (signal?: AbortSignal) => Promise<TraceRecording>;
  navigation?: DashboardNavigation;
  onCompare: () => void;
  onOpen: () => void;
  onRefresh: () => void;
  rawRecordingUrl?: string;
  recording: TraceRecording;
  sessionClient?: SessionClient;
  summary?: SessionSummary;
}

const NAV: { id: Section; label: string; subtitle: string }[] = [
  { id: 'overview', label: 'Overview', subtitle: 'The recording at a glance' },
  {
    id: 'problems',
    label: 'Problems',
    subtitle: 'Signals worth investigating',
  },
  {
    id: 'functions',
    label: 'Functions',
    subtitle: 'Where execution time went',
  },
  { id: 'frames', label: 'Trace frames', subtitle: 'Follow the call graph' },
];

function navigationHref(
  navigation: DashboardNavigation | undefined,
  view: DashboardViewState,
) {
  const href = navigation?.href;
  return href ? (page: string) => href({ ...view, page }) : undefined;
}
function useDashboardView(controlledNavigation?: DashboardNavigation) {
  const [localView, setLocalView] = useState<DashboardViewState>({
    page: 'overview',
  });
  const view = controlledNavigation?.state ?? localView;
  const update = controlledNavigation?.onChange ?? setLocalView;
  const section = view.page;
  const setSection = (page: string) => update({ ...view, page });
  const root = view.root ?? '';
  const setRoot = (value: string) => update({ ...view, root: value });
  const query = view.query ?? '';
  const setQuery = (value: string) => update({ ...view, query: value }, true);
  const selectedRay = view.ray ?? '';
  const selectedFrame = view.frame;
  const setSelectedFrame = (frame: number) => update({ ...view, frame });
  const selectedTimeBucket = Math.min(47, view.bucket ?? 0);
  const selectTimeBucket = (bucket: number) => update({ ...view, bucket });

  return {
    href: navigationHref(controlledNavigation, view),
    query,
    root,
    section,
    selectedFrame,
    selectedRay,
    selectedTimeBucket,
    selectTimeBucket,
    setQuery,
    setRoot,
    setSection,
    setSelectedFrame,
    update,
    view,
  };
}

function inspectFramesNavigation(
  browserOnly: boolean,
  update: ReturnType<typeof useDashboardView>['update'],
) {
  if (browserOnly) {
    return undefined;
  }
  return (filters: Partial<FrameQuery>) =>
    update({
      ...filters,
      frameOffset: 0,
      frameQuery: filters.query,
      page: 'frames',
      rootsOnly: filters.rootsOnly ? 'true' : undefined,
    });
}

export function CoreRecordingDashboard({
  extensions = {},
  functionAnalysis,
  loadRecording,
  navigation: controlledNavigation,
  onCompare,
  onOpen,
  onRefresh,
  rawRecordingUrl,
  recording,
  sessionClient,
  summary,
}: Props) {
  const {
    href,
    query,
    root,
    section,
    selectedFrame,
    selectedRay,
    selectedTimeBucket,
    selectTimeBucket,
    setQuery,
    setRoot,
    setSection,
    setSelectedFrame,
    update,
    view,
  } = useDashboardView(controlledNavigation);
  const browserOnly = recording.mode === 'browser';
  const { browser: browserSummary, traceDataExcluded } =
    summaryMetadata(summary);
  const navigation = dashboardNavigation(extensions, browserOnly).filter(
    (item) => !traceDataExcluded || item.id !== 'frames',
  );
  useEffect(() => {
    if (browserOnly && ['frames', 'functions'].includes(section)) {
      update({ page: 'overview' }, true);
    }
  }, [browserOnly, section, update]);
  const { theme, toggleTheme } = useDashboardTheme();
  const [sort, setSort] = useState<SortKey>('totalDuration');
  const [frameLimit, setFrameLimit] = useState(250);
  const { activeRayId, analysis, filtered, frame, rayEvents } =
    useRecordingAnalysis(
      recording,
      root,
      selectedRay,
      selectedFrame,
      summary,
      functionAnalysis,
    );
  const { CustomPage, page } = activePage(navigation, section, extensions);
  const activeSection = page.id;

  const selectRay = (ray: string) => {
    update({ ...view, frame: undefined, frameOffset: 0, ray });
    setFrameLimit(250);
  };

  const inspectFunction = (item: CoreFunctionStat) => {
    update({
      ...view,
      page: 'functions',
      query: `${item.namespace}.${item.name}`,
      root: '',
    });
  };

  return (
    <DashboardContextProvider
      value={{
        analysis,
        browserSummary,
        dataScope: summary ? 'summary' : 'complete',
        inspectFrames: traceDataExcluded
          ? undefined
          : inspectFramesNavigation(browserOnly, update),
        loadRecording,
        navigate: setSection,
        navigation: { onChange: update, state: view },
        page: activeSection,
        query,
        recording,
        root,
        selectedFrame: frame,
        selectedFunction: view.functionId,
        selectedRay: activeRayId,
        selectedTimeBucket,
        selectFrame: setSelectedFrame,
        selectFunction: (functionId) => update({ ...view, functionId }),
        selectRay,
        selectTimeBucket: (value) =>
          selectTimeBucket(Math.min(47, Math.max(0, Math.floor(value)))),
        sessionClient,
        setQuery,
        setRoot,
        traceDataExcluded,
      }}
    >
      <DashboardCustomizationProvider value={extensions}>
        <DashboardShell
          sidebar={
            <DashboardSidebar
              findings={analysis.findings.length}
              href={href}
              navigation={navigation}
              onHome={onOpen}
              onSection={setSection}
              onTheme={toggleTheme}
              recording={recording}
              section={activeSection}
              theme={theme}
            />
          }
          theme={theme}
          toolbar={
            <DashboardToolbar
              actions={extensions.toolbarActions}
              onCompare={onCompare}
              onOpen={onOpen}
              onRefresh={onRefresh}
              onTheme={toggleTheme}
              recording={recording}
              section={page.label}
              standalone={traceDataExcluded}
              theme={theme}
            />
          }
        >
          <DashboardHeading page={page} recording={recording} />
          {traceDataExcluded && (
            <p className="cd-table-hint" role="status">
              Standalone dashboard · full recording summaries and function call
              paths. Raw traces and filters requiring individual calls are
              excluded.
            </p>
          )}
          {activeSection === 'overview' && (
            <DashboardPage id="overview">
              <Overview
                analysis={analysis}
                browserSummary={browserSummary}
                extensions={extensions}
                recording={recording}
              />
            </DashboardPage>
          )}
          {activeSection === 'problems' && (
            <DashboardPage id="problems">
              <Problems
                analysis={analysis}
                extensions={extensions}
                onFunction={inspectFunction}
                rawRecordingUrl={rawRecordingUrl}
                recording={recording}
              />
            </DashboardPage>
          )}
          {activeSection === 'functions' && (
            <DashboardPage id="functions">
              <Functions
                analysis={filtered}
                extensions={extensions}
                onQuery={setQuery}
                onRoot={setRoot}
                onSort={setSort}
                query={query}
                root={root}
                roots={analysis.roots}
                sort={sort}
              />
            </DashboardPage>
          )}
          {activeSection === 'frames' && (
            <DashboardPage id="frames">
              <FrameContent
                activeRay={activeRayId}
                client={sessionClient}
                events={rayEvents}
                extensions={extensions}
                frame={frame}
                frameLimit={frameLimit}
                navigation={{ onChange: update, state: view }}
                onCloseFrame={() => update({ ...view, frame: undefined })}
                onFrame={setSelectedFrame}
                onLimit={() => setFrameLimit((value) => value + 250)}
                onRay={selectRay}
                rays={analysis.rays}
                recording={recording}
              />
            </DashboardPage>
          )}
          {CustomPage && <CustomPage />}
        </DashboardShell>
      </DashboardCustomizationProvider>
    </DashboardContextProvider>
  );
}

function FrameContent({
  client,
  navigation,
  ...props
}: Parameters<typeof Frames>[0] & {
  client?: SessionClient;
  navigation: DashboardNavigation;
}) {
  const dataClient = useMemo(
    () => client ?? createLocalSessionClient(props.recording),
    [client, props.recording],
  );
  return props.recording.mode !== 'light' ? (
    <RemoteFrames
      client={dataClient}
      extensions={props.extensions ?? {}}
      navigation={navigation}
      sessionId={props.recording.sessionId}
    />
  ) : (
    <Frames {...props} />
  );
}

function activePage(
  navigation: typeof NAV,
  section: string,
  extensions: CoreDashboardExtensions,
) {
  const page = navigation.find((item) => item.id === section) ?? navigation[0]!;
  const CustomPage = extensions.additionalPages?.find(
    (item) => item.id === page.id,
  )?.component;
  return { CustomPage, page };
}

function dashboardNavigation(
  extensions: CoreDashboardExtensions,
  browserOnly: boolean,
) {
  validateCustomization(extensions, extensions.functionColumns);
  const navigation = NAV.filter(
    (item) =>
      (!browserOnly || !['frames', 'functions'].includes(item.id)) &&
      extensions.pages?.[
        item.id as keyof NonNullable<DashboardCustomization['pages']>
      ] !== false,
  ).concat(extensions.additionalPages ?? []);
  if (!navigation.length) {
    throw new Error('The dashboard requires at least one visible page');
  }
  return navigation;
}

function useRecordingAnalysis(
  recording: TraceRecording,
  root: string,
  selectedRay: string,
  selectedFrame: number | undefined,
  summary?: SessionSummary,
  functionAnalysis?: CoreAnalysis,
) {
  const analysis = useMemo(
    () => summary?.analysis ?? analyzeCoreRecording(recording),
    [recording, summary],
  );
  const filtered = useMemo(
    () =>
      functionAnalysis ??
      (root && !summary ? analyzeCoreRecording(recording, root) : analysis),
    [analysis, recording, root, summary, functionAnalysis],
  );
  const activeRay =
    analysis.rays.find((item) => item.ray === selectedRay) ?? analysis.rays[0];
  const rayEvents =
    recording.traces.find((item) => item.ray === activeRay?.ray)?.events ?? [];
  const frame = rayEvents.find((item) => item.id === selectedFrame);
  return {
    activeRayId: selectedRay || activeRay?.ray,
    analysis,
    filtered,
    frame,
    rayEvents,
  };
}

export function DashboardSidebar({
  findings,
  href,
  navigation,
  onHome,
  onSection,
  onTheme,
  recording,
  section,
  theme,
}: {
  findings: number;
  href?: (page: string) => string;
  navigation: typeof NAV;
  onHome: () => void;
  onSection: (section: Section) => void;
  onTheme: () => void;
  recording?: TraceRecording;
  section: Section;
  theme: Theme;
}) {
  return (
    <aside className="cd-sidebar">
      <div className="cd-brand">
        <span aria-hidden="true" className="cd-brand-symbol">
          <DashboardIcon name="pulse" size={24} />
        </span>
        <div>
          <strong>Trace</strong>
          <small>Performance workspace</small>
        </div>
      </div>
      {recording && (
        <div className="cd-session-card">
          <div className="cd-session-card-header">
            <span className="cd-sidebar-label">CURRENT RECORDING</span>
            <button
              aria-label="Back to sessions"
              className="cd-icon-button cd-session-card-back"
              onClick={onHome}
              title="Back to sessions"
              type="button"
            >
              <DashboardIcon name="arrow-left" />
            </button>
          </div>
          <strong title={recording.title || 'Untitled recording'}>
            {recording.title || 'Untitled recording'}
          </strong>
          <span>
            {formatDuration(recording.duration)} ·{' '}
            {recording.mode === 'browser'
              ? 'Browser'
              : recording.mode === 'light'
                ? 'Light'
                : 'Full'}
          </span>
          <RecordingId
            key={recording.sessionId}
            sessionId={recording.sessionId}
          />
        </div>
      )}
      <span className="cd-sidebar-label">LIBRARY</span>
      <nav className="cd-navigation">
        <button
          aria-current={section === 'sessions' ? 'page' : undefined}
          onClick={onHome}
        >
          <span aria-hidden="true" className="cd-library-icon">
            <DashboardIcon name="sessions" size={20} />
          </span>
          <span>Sessions</span>
        </button>
      </nav>
      {navigation.length > 0 && (
        <span className="cd-sidebar-label cd-section-label">
          SESSION ANALYTICS
        </span>
      )}
      <nav aria-label="Dashboard sections" className="cd-navigation">
        {navigation.map((item) =>
          href ? (
            <a
              aria-current={section === item.id ? 'page' : undefined}
              href={href(item.id)}
              key={item.id}
              onClick={(event) => {
                if (
                  !event.metaKey &&
                  !event.ctrlKey &&
                  !event.shiftKey &&
                  !event.altKey &&
                  event.button === 0
                ) {
                  event.preventDefault();
                  onSection(item.id);
                }
              }}
            >
              <NavIcon section={item.id} />
              <span>{item.label}</span>
              {item.id === 'problems' && findings > 0 && <em>{findings}</em>}
            </a>
          ) : (
            <button
              aria-current={section === item.id ? 'page' : undefined}
              key={item.id}
              onClick={() => onSection(item.id)}
              type="button"
            >
              <NavIcon section={item.id} />
              <span>{item.label}</span>
              {item.id === 'problems' && findings > 0 && <em>{findings}</em>}
            </button>
          ),
        )}
      </nav>
      <div className="cd-sidebar-bottom">
        <button className="cd-theme-button" onClick={onTheme} type="button">
          <span aria-hidden="true">
            <DashboardIcon name={theme === 'light' ? 'moon' : 'sun'} />
          </span>
          {theme === 'light' ? 'Dark appearance' : 'Light appearance'}
        </button>
      </div>
    </aside>
  );
}

function RecordingId({ sessionId }: { sessionId: string }) {
  const [copyState, setCopyState] = useState<'copied' | 'error' | 'idle'>(
    'idle',
  );
  const copy = async () => {
    try {
      await copyText(sessionId);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };
  return (
    <div className="cd-session-id">
      <span>ID</span>
      <code title={sessionId}>{sessionId}</code>
      <button
        aria-label={
          copyState === 'copied' ? 'Recording ID copied' : 'Copy recording ID'
        }
        className="cd-icon-button"
        onClick={() => void copy()}
        title={
          copyState === 'error'
            ? 'Could not copy recording ID'
            : 'Copy recording ID'
        }
        type="button"
      >
        <DashboardIcon
          name={copyState === 'copied' ? 'check' : 'copy'}
          size={14}
        />
      </button>
    </div>
  );
}

function DashboardToolbar({
  actions,
  onCompare,
  onOpen,
  onRefresh,
  onTheme,
  recording,
  section,
  standalone,
  theme,
}: {
  actions?: ReactNode;
  onCompare: () => void;
  onOpen: () => void;
  onRefresh: () => void;
  onTheme: () => void;
  recording: TraceRecording;
  section: string;
  standalone?: boolean;
  theme: Theme;
}) {
  return (
    <header className="cd-toolbar">
      <div className="cd-breadcrumb">
        <span>Recording</span>
        <span>/</span>
        <strong>{section}</strong>
      </div>
      <div className="cd-toolbar-actions">
        {actions}
        {!standalone && recording.status === 'recording' && (
          <button className="cd-button" onClick={onRefresh} type="button">
            Refresh
          </button>
        )}
        {!standalone && (
          <button className="cd-button" onClick={onCompare} type="button">
            Compare
          </button>
        )}
        <button
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} appearance`}
          className="cd-button cd-toolbar-theme"
          onClick={onTheme}
          type="button"
        >
          <DashboardIcon name={theme === 'light' ? 'moon' : 'sun'} />
        </button>
        <button
          className="cd-button cd-button-primary"
          onClick={onOpen}
          type="button"
        >
          {standalone ? 'Overview' : 'All sessions'}
        </button>
      </div>
    </header>
  );
}

function DashboardHeading({
  page,
  recording,
}: {
  page: (typeof NAV)[number];
  recording: TraceRecording;
}) {
  return (
    <div className="cd-page-heading">
      <div>
        <span className="cd-kicker">
          <span className="cd-status-dot" />
          {recording.status === 'recording'
            ? 'LIVE SESSION'
            : 'RECORDED SESSION'}
        </span>
        <h1>{page.label}</h1>
        <p>{page.subtitle}</p>
      </div>
      <div className="cd-heading-meta">
        <span>{recording.title || 'Untitled recording'}</span>
        <span>
          {recording.mode === 'browser'
            ? 'Browser capture'
            : recording.mode === 'light'
              ? 'Light capture'
              : 'Full capture'}
        </span>
      </div>
    </div>
  );
}

function NavIcon({ section }: { section: Section }) {
  const name =
    section === 'overview' ||
    section === 'functions' ||
    section === 'frames' ||
    section === 'problems'
      ? section
      : 'list';
  return <DashboardIcon name={name} size={20} />;
}

export function Overview({
  analysis,
  browserSummary,
  extensions,
  recording,
}: {
  analysis: CoreAnalysis;
  browserSummary?: SessionSummary['browser'];
  extensions?: CoreDashboardExtensions;
  recording: TraceRecording;
}) {
  const {
    selectedTimeBucket: selectedBucket,
    selectTimeBucket: setSelectedBucket,
  } = useDashboard();
  return (
    <div className="cd-stack">
      {recording.mode === 'browser' && (
        <section className="cd-card cd-browser-mode-notice" role="status">
          <h2>Browser signals only</h2>
          <p>
            Function recording is off. Calls and trace frames were not captured.
          </p>
        </section>
      )}
      <DashboardBlock id="overview.metrics">
        <div className="cd-metrics">
          <Metric
            hint="Captured session"
            label="Recording length"
            value={formatDuration(recording.duration)}
          />
          {recording.mode !== 'browser' && (
            <Metric
              hint={`${analysis.functions.length.toLocaleString()} unique functions`}
              label="Function calls"
              value={analysis.calls.toLocaleString()}
            />
          )}
          <Metric
            hint="Browser responsiveness"
            label="Main-thread blocking"
            value={
              recording.cpuSource && recording.cpuSource !== 'unavailable'
                ? formatDuration(analysis.blockingTotal)
                : 'Unavailable'
            }
          />
          <Metric
            hint="Findings to review"
            label="Problems"
            value={analysis.findings.length.toLocaleString()}
            warning={analysis.findings.length > 0}
          />
        </div>
      </DashboardBlock>
      {recording.mode !== 'browser' && (
        <DashboardBlock id="overview.timeline">
          <section className="cd-card cd-timeline-card">
            <CardHeading
              detail="Function starts and browser blocking on one clock"
              eyebrow="ACTIVITY"
              title="Recording timeline"
            />
            <Timeline
              analysis={analysis}
              duration={recording.duration}
              light={recording.mode === 'light'}
              onSelect={setSelectedBucket}
              selected={selectedBucket}
            />
            <OverviewSliceFunctions
              aggregateFunctions={analysis.functions}
              recording={recording}
              summary={browserSummary}
            />
          </section>
        </DashboardBlock>
      )}
      <DashboardBlock id="overview.browser-signals">
        <CoreBrowserSignals
          onSelect={setSelectedBucket}
          recording={recording}
          selected={selectedBucket}
          summary={browserSummary}
        />
      </DashboardBlock>
      {extensions?.overview}
      {extensions?.overviewBlocks?.map(({ component: Block, id }) => (
        <Block key={id} />
      ))}
    </div>
  );
}

export function Problems({
  analysis,
  extensions,
  onFunction,
  rawRecordingUrl,
  recording,
}: {
  analysis: CoreAnalysis;
  extensions?: CoreDashboardExtensions;
  onFunction: (item: CoreFunctionStat) => void;
  rawRecordingUrl?: string;
  recording: TraceRecording;
}) {
  const [severity, setSeverity] = useState<'all' | CoreFinding['severity']>(
    'all',
  );
  const [copyState, setCopyState] = useState<'copied' | 'error' | 'idle'>(
    'idle',
  );
  const visible = analysis.findings.filter(
    (item) => severity === 'all' || item.severity === severity,
  );
  const copyReport = async () => {
    const markdown = formatProblemReportMarkdown({
      dashboardUrl: window.location.href,
      findings: analysis.findings,
      functions: analysis.functions,
      rawRecordingUrl,
      recording,
    });
    try {
      await copyText(markdown);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };
  return (
    <div className="cd-stack">
      <div className="cd-problems-heading">
        <SectionIntro
          count={`${analysis.findings.length} findings`}
          detail="Findings use only common trace data. They suggest where to investigate, not a proven root cause."
          title="Detected signals"
        />
        <button
          className="cd-button"
          onClick={() => void copyReport()}
          type="button"
        >
          {copyState === 'copied'
            ? 'Copied Markdown'
            : copyState === 'error'
              ? 'Copy failed'
              : 'Copy as Markdown'}
        </button>
      </div>
      <div aria-label="Filter problems by severity" className="cd-filter-bar">
        {(['all', 'critical', 'warning', 'notice'] as const).map((item) => (
          <button
            aria-pressed={severity === item}
            key={item}
            onClick={() => setSeverity(item)}
            type="button"
          >
            <SeverityIcon severity={item} />
            {capitalize(item)}
          </button>
        ))}
      </div>
      <div className="cd-problem-list">
        {visible.map((finding) => (
          <ProblemCard
            finding={finding}
            functions={analysis.functions}
            key={finding.id}
            onFunction={onFunction}
          />
        ))}
        {!visible.length && (
          <div className="cd-card">
            <EmptyState
              detail="Try another severity or record a longer flow."
              title="Nothing in this filter"
            />
          </div>
        )}
      </div>
      {extensions?.problems}
    </div>
  );
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) {
    throw new Error('Clipboard copy is unavailable');
  }
}

function ProblemCard({
  finding,
  functions,
  onFunction,
}: {
  finding: CoreFinding;
  functions: CoreFunctionStat[];
  onFunction: (item: CoreFunctionStat) => void;
}) {
  const related = functions.find(
    (item) => functionKey(item.namespace, item.name) === finding.functionKey,
  );
  return (
    <article className="cd-card cd-problem">
      <div>
        <span className={`cd-severity cd-severity-${finding.severity}`}>
          <SeverityIcon severity={finding.severity} />
          {capitalize(finding.severity)}
        </span>
        <h3>{finding.title}</h3>
        <p>{finding.description}</p>
        <strong>{finding.metric}</strong>
      </div>
      {related && (
        <button
          className="cd-button"
          onClick={() => onFunction(related)}
          type="button"
        >
          Inspect function
        </button>
      )}
    </article>
  );
}

const FUNCTION_PAGE_SIZE = 50;

export function Functions({
  analysis: initialAnalysis,
  extensions,
  onSort,
  query,
  root,
  sort,
}: {
  analysis: CoreAnalysis;
  extensions?: CoreDashboardExtensions;
  onQuery: (value: string) => void;
  onRoot: (value: string) => void;
  onSort: (value: SortKey) => void;
  query: string;
  root: string;
  roots: CoreAnalysis['roots'];
  sort: SortKey;
}) {
  const context = useDashboard();
  const errorsOnly = failedCallsOnly(context);
  const {
    analysis,
    error: scopeError,
    filters: queryState,
    loading,
  } = useFunctionAnalysis(initialAnalysis, root, errorsOnly);
  const [localSelection, setLocalSelection] = useState('');
  const selected = context.selectedFunction ?? localSelection;
  const setSelected = context.selectFunction ?? setLocalSelection;
  const [direction, setDirection] = useState(-1);
  const [limit, setLimit] = useState(FUNCTION_PAGE_SIZE);
  const scopeKey = JSON.stringify(queryState);
  useEffect(() => setLimit(FUNCTION_PAGE_SIZE), [scopeKey]);
  const columns = functionColumns(extensions);
  const activeQuery = queryState.query ?? query;
  const matches = analysis.functions.filter(
    (item) =>
      `${item.namespace}.${item.name}`
        .toLowerCase()
        .includes(activeQuery.toLowerCase()) &&
      (!errorsOnly || item.errors > 0),
  );
  const visible = matches
    .sort(
      (left, right) =>
        (sortValue(left, sort, columns) - sortValue(right, sort, columns)) *
        direction,
    )
    .slice(limit - FUNCTION_PAGE_SIZE, limit);
  const selectedItem = analysis.functions.find(
    (item) => functionKey(item.namespace, item.name) === selected,
  );
  const sortColumn = (key: SortKey) => {
    setDirection(sort === key ? -direction : -1);
    onSort(key);
  };
  return (
    <div className="cd-stack">
      <FunctionTimeline query={{ ...queryState, root }} />
      {scopeError && <p role="alert">{scopeError}</p>}
      <DashboardBlock id="functions.table">
        <div className="cd-card cd-function-card">
          <div className="cd-results-heading">
            {' '}
            <SectionIntro
              count={functionCountLabel(loading, matches.length)}
              detail={functionDescription(context.recording.mode)}
              title="Function costs"
            />
          </div>
          <ExplorerFilters embedded functions />
          {columns.length > 0 && (
            <p className="cd-table-hint">
              Scroll horizontally to see extension columns →
            </p>
          )}
          <FunctionCostsTable
            columns={columns}
            extensionHeadings={columns.map((column) => (
              <ExtensionSortHeading
                column={column}
                direction={direction}
                key={column.id}
                onSort={sortColumn}
                sort={sort}
              />
            ))}
            headings={
              <>
                <SortHeading
                  column="calls"
                  direction={direction}
                  label="Calls"
                  onSort={sortColumn}
                  sort={sort}
                />
                <SortHeading
                  column="average"
                  direction={direction}
                  label="Average"
                  onSort={sortColumn}
                  sort={sort}
                />
                <SortHeading
                  column="totalDuration"
                  direction={direction}
                  label="Total"
                  onSort={sortColumn}
                  sort={sort}
                />
                <SortHeading
                  column="maxDuration"
                  direction={direction}
                  label="Slowest"
                  onSort={sortColumn}
                  sort={sort}
                />
                <SortHeading
                  column="errors"
                  direction={direction}
                  label="Errors"
                  onSort={sortColumn}
                  sort={sort}
                />
              </>
            }
            items={visible}
            loading={loading}
            onInspect={(item) =>
              setSelected(functionKey(item.namespace, item.name))
            }
            renderAction={(item) => <FunctionDrilldown item={item} />}
            selected={selected}
          />
          <FunctionStatus
            empty={!visible.length}
            error={scopeError}
            loading={loading}
          />
          <div className="cd-pagination">
            <button
              className="cd-button"
              disabled={limit <= FUNCTION_PAGE_SIZE}
              onClick={() => setLimit(limit - FUNCTION_PAGE_SIZE)}
            >
              Previous
            </button>
            <span>
              {matches.length
                ? `${limit - FUNCTION_PAGE_SIZE + 1}–${Math.min(limit, matches.length)} of ${matches.length} functions`
                : loading
                  ? 'Loading…'
                  : 'No functions'}
            </span>
            <button
              className="cd-button"
              disabled={matches.length <= limit}
              onClick={() => setLimit(limit + FUNCTION_PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        </div>
      </DashboardBlock>
      {selectedItem && (
        <FunctionDrawer
          filters={queryState}
          identity={selectedItem}
          item={selectedItem}
          onClose={() => setSelected('')}
        />
      )}
    </div>
  );
}

function SortHeading({
  column,
  direction,
  label,
  onSort,
  sort,
}: {
  column: SortKey;
  direction: number;
  label: string;
  onSort: (key: SortKey) => void;
  sort: SortKey;
}) {
  return (
    <th
      aria-sort={
        sort === column
          ? direction === 1
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <button className="cd-sort-heading" onClick={() => onSort(column)}>
        {label}
        <DashboardIcon
          name={
            sort === column
              ? direction === 1
                ? 'arrow-up'
                : 'arrow-down'
              : 'sort'
          }
          size={12}
        />
      </button>
    </th>
  );
}
export function FunctionDrawer({
  error,
  filters,
  identity,
  item,
  loading = false,
  onClose,
}: {
  error?: string;
  filters: FrameQuery;
  identity: Pick<CoreFunctionStat, 'name' | 'namespace'>;
  item?: CoreFunctionStat;
  loading?: boolean;
  onClose: () => void;
}) {
  const { recording, root } = useDashboard();
  return (
    <InspectorDrawer
      companion={
        <ExplorerTimeline
          query={{
            ...filters,
            name: identity.name,
            namespace: identity.namespace,
            root,
          }}
          showCallMarkers
        />
      }
      onClose={onClose}
      subtitle={identity.namespace}
      title={identity.name}
    >
      <FunctionDrawerMetrics item={item} loading={loading} />
      <FunctionDrawerStatus error={error} item={item} loading={loading} />
      <p className="cd-table-hint">
        Inclusive time includes nested calls. Compare equivalent interactions
        before drawing conclusions.
      </p>
      <FunctionDrawerAction item={item} light={recording.mode === 'light'} />
    </InspectorDrawer>
  );
}
function FunctionDrawerMetrics({
  item,
  loading,
}: {
  item?: CoreFunctionStat;
  loading: boolean;
}) {
  const values = item
    ? [
        item.calls.toLocaleString(),
        formatDuration(item.totalDuration),
        formatDuration(item.totalDuration / Math.max(1, item.calls)),
        formatDuration(item.maxDuration),
        formatDuration(item.minDuration),
        `${((100 * item.errors) / Math.max(1, item.calls)).toFixed(1)}%`,
      ]
    : Array<string>(6).fill(loading ? '…' : '—');
  return (
    <div className="cd-drawer-metrics">
      {[
        'Calls',
        'Inclusive time',
        'Average',
        'Slowest',
        'Fastest',
        'Error rate',
      ].map((label, index) => (
        <div key={label}>
          <span>{label}</span>
          <strong>{values[index]}</strong>
        </div>
      ))}
    </div>
  );
}
function FunctionDrawerStatus({
  error,
  item,
  loading,
}: {
  error?: string;
  item?: CoreFunctionStat;
  loading: boolean;
}) {
  if (item) {
    return null;
  }
  return (
    <p role={error ? 'alert' : 'status'}>
      {error
        ? 'Could not load function details.'
        : loading
          ? 'Loading function details…'
          : 'No matching calls in the current view.'}
    </p>
  );
}
function FunctionDrawerAction({
  item,
  light,
}: {
  item?: CoreFunctionStat;
  light: boolean;
}) {
  if (!item) {
    return null;
  }
  return light ? (
    <p>Individual frames are not captured in light mode.</p>
  ) : (
    <div className="cd-drawer-actions">
      <FunctionDrilldown item={item} labeled />
    </div>
  );
}

export function Frames({
  activeRay,
  events,
  extensions,
  frame,
  frameLimit,
  onCloseFrame,
  onFrame,
  onLimit,
  onRay,
  rays,
  recording,
}: {
  activeRay?: string;
  events: TraceEvent[];
  extensions?: CoreDashboardExtensions;
  frame?: TraceEvent;
  frameLimit: number;
  onCloseFrame?: () => void;
  onFrame: (id: number) => void;
  onLimit: () => void;
  onRay: (ray: string) => void;
  rays: CoreAnalysis['rays'];
  recording: TraceRecording;
}) {
  const [query, setQuery] = useState('');
  const [rayLimit, setRayLimit] = useState(250);
  const byId = useMemo(
    () => new Map(events.map((item) => [item.id, item])),
    [events],
  );
  const matches = events.filter((item) =>
    `${item.namespace}.${item.name}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const visible = matches.slice(0, frameLimit);
  if (recording.mode === 'light') {
    return (
      <div className="cd-card">
        <EmptyState
          detail="Start a full recording when you need exact call order, parent links, and per-call context."
          title="Frames are not captured in light mode"
        />
      </div>
    );
  }
  return (
    <div className="cd-frames-layout">
      <aside className="cd-card cd-ray-list">
        <CardHeading
          detail={`${rays.length.toLocaleString()} independent roots`}
          eyebrow="CALL GRAPHS"
          title="Trace rays"
        />
        <div className="cd-ray-scroll">
          {rays.slice(0, rayLimit).map((ray) => (
            <button
              aria-current={activeRay === ray.ray ? 'true' : undefined}
              key={ray.ray}
              onClick={() => onRay(ray.ray)}
              type="button"
            >
              <strong>{ray.name}</strong>
              <small>
                {ray.calls.toLocaleString()} calls ·{' '}
                {formatDuration(ray.duration)}
              </small>
            </button>
          ))}
        </div>
        {rays.length > rayLimit && (
          <button
            className="cd-load-more"
            onClick={() => setRayLimit((value) => value + 250)}
            type="button"
          >
            Show 250 more rays
          </button>
        )}
      </aside>
      <section className="cd-card cd-frame-list">
        <div className="cd-frame-header">
          <CardHeading
            detail={`${events.length.toLocaleString()} events`}
            eyebrow="FRAMES"
            title="Call sequence"
          />
          <label className="cd-search">
            <span>Find a frame</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Function or namespace"
              type="search"
              value={query}
            />
          </label>
        </div>
        <div className="cd-frame-scroll">
          {visible.map((item) => (
            <button
              aria-current={frame?.id === item.id ? 'true' : undefined}
              className={`cd-frame-row ${item.kind === 'marker' ? 'cd-marker-row' : ''}`}
              key={`${item.ray}:${item.id}`}
              onClick={() => onFrame(item.id)}
              type="button"
            >
              <span
                className="cd-frame-name"
                style={{ paddingLeft: Math.min(depthOf(item, byId), 10) * 15 }}
              >
                <NamespaceBadge name={item.namespace || 'unknown'} />
                <TraceKindIcon kind={item.kind} />
                <span>{item.name}</span>
              </span>
              <span className="cd-frame-duration">
                {item.kind === 'call'
                  ? formatDuration(item.duration)
                  : 'Marker'}
              </span>
            </button>
          ))}
          {!visible.length && (
            <EmptyState
              detail="Select another ray or change the search."
              title="No frames found"
            />
          )}
        </div>
        {matches.length > frameLimit && (
          <button className="cd-load-more" onClick={onLimit} type="button">
            Show 250 more frames
          </button>
        )}
      </section>
      {frame && (
        <InspectorDrawer
          onClose={onCloseFrame ?? (() => undefined)}
          subtitle={frame.namespace}
          title={frame.name}
        >
          <DashboardBlock id="frames.inspector">
            <FrameInspector
              event={frame}
              extensions={extensions}
              rayMetadata={
                recording.traces.find((trace) => trace.ray === activeRay)
                  ?.metadata
              }
            />
          </DashboardBlock>
        </InspectorDrawer>
      )}
    </div>
  );
}

export function FrameInspector({
  event,
  extensions,
  rayMetadata,
}: {
  event: TraceEvent;
  extensions?: CoreDashboardExtensions;
  rayMetadata?: Record<string, unknown>;
}) {
  return (
    <div className="cd-inspector-body">
      <h3>{event.name}</h3>
      <p>{event.namespace || 'unknown'}</p>
      {rayMetadata && <Payload label="Ray metadata" value={rayMetadata} />}
      <dl>
        <div>
          <dt>Frame ID</dt>
          <dd>{event.id}</dd>
        </div>
        <div>
          <dt>Ray</dt>
          <dd>{event.ray}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{event.kind}</dd>
        </div>
        <div>
          <dt>Start</dt>
          <dd>{formatDuration(event.at)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatDuration(event.duration)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{event.status || '—'}</dd>
        </div>
      </dl>
      {event.data !== undefined && (
        <Payload label="Recorded context" value={event.data} />
      )}
      {event.arguments !== undefined && (
        <Payload label="Arguments" value={event.arguments} />
      )}
      {event.error !== undefined && (
        <Payload label="Error" value={event.error} />
      )}
      {event.memory !== undefined && (
        <Payload label="Memory" value={event.memory} />
      )}
      {extensions?.frameDetails?.(event)}
    </div>
  );
}

export function Timeline({
  analysis,
  duration,
  light,
  onSelect,
  selected,
}: {
  analysis: CoreAnalysis;
  duration: number;
  light: boolean;
  onSelect: (index: number) => void;
  selected: number;
}) {
  const { range, selectRange } = useTimelineRange();
  const { navigation } = useDashboard();
  const clearSelection = () =>
    navigation?.onChange({
      ...navigation.state,
      from: undefined,
      to: undefined,
    });
  return (
    <div>
      <AnalyticsChart
        bucketMs={1_000}
        duration={duration}
        onRange={selectRange}
        onSelect={(index) =>
          onSelect(
            Math.min(
              TIMELINE_BUCKETS - 1,
              Math.floor(
                ((index * 1_000 + Math.min(500, duration - index * 1_000)) /
                  Math.max(duration, 1)) *
                  TIMELINE_BUCKETS,
              ),
            ),
          )
        }
        range={range}
        selected={secondIndex(
          ((selected + 0.5) / TIMELINE_BUCKETS) * duration,
          analysis.activity.length,
          duration,
        )}
        series={[
          {
            color: metricColor('resource.transfer-size'),
            format: (value) => Math.round(value).toLocaleString(),
            label: 'Root calls',
            tooltipOnly: true,
            unavailable: light ? 'Unavailable in light capture' : undefined,
            values:
              analysis.rootActivity ?? Array(analysis.activity.length).fill(0),
          },
          {
            color: metricColor('function.calls'),
            format: (value) => Math.round(value).toLocaleString(),
            label:
              light && analysis.activityEstimated
                ? 'Estimated all calls'
                : 'All calls',
            values: analysis.activity,
          },
          {
            color: metricColor('thread.blocking'),
            format: formatDuration,
            label: 'Main-thread blocking',
            values:
              analysis.timelineBlocking ??
              Array(analysis.activity.length).fill(0),
          },
        ]}
      />
      <div className="cd-timeline-selection">
        <span className="cd-browser-range">
          {range
            ? `${formatDuration(range[0])}–${formatDuration(range[1])}`
            : 'Entire recording'}
        </span>
        {light && (
          <span className="cd-timeline-note">
            {analysis.activityEstimated
              ? 'Light capture estimates calls within each second from aggregated windows.'
              : 'Calls are counted in aligned one-second capture windows.'}{' '}
            Root calls require a full recording.
          </span>
        )}
        {range && (
          <button className="cd-button" onClick={clearSelection} type="button">
            Clear selection
          </button>
        )}
      </div>
    </div>
  );
}

function Metric({
  hint,
  label,
  value,
  warning = false,
}: {
  hint: string;
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className={`cd-card cd-metric ${warning ? 'cd-metric-warning' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function CardHeading({
  detail,
  eyebrow,
  title,
}: {
  detail: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="cd-card-heading">
      <div>
        <span className="cd-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function SectionIntro({
  count,
  detail,
  title,
}: {
  count: string;
  detail: string;
  title: string;
}) {
  return (
    <div className="cd-section-intro">
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      <span className="cd-count-pill">{count}</span>
    </div>
  );
}

function EmptyState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="cd-empty">
      <span aria-hidden="true">○</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="cd-payload">
      <span className="cd-eyebrow">{label}</span>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

function depthOf(event: TraceEvent, byId: Map<number, TraceEvent>): number {
  let depth = 0;
  let parent = event.parent ? byId.get(event.parent) : undefined;
  while (parent && depth < 20) {
    depth += 1;
    parent = parent.parent ? byId.get(parent.parent) : undefined;
  }
  return depth;
}

function sortValue(
  item: CoreFunctionStat,
  sort: SortKey,
  columns: CoreFunctionColumn[],
): number {
  if (sort === 'average') {
    return item.totalDuration / Math.max(item.calls, 1);
  }
  if (sort.startsWith('extension:')) {
    return (
      columns
        .find((column) => column.id === sort.slice(10))
        ?.sortValue?.(item) ?? 0
    );
  }
  switch (sort) {
    case 'calls':
      return item.calls;
    case 'errors':
      return item.errors;
    case 'maxDuration':
      return item.maxDuration;
    case 'totalDuration':
      return item.totalDuration;
    default:
      return 0;
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function FunctionTimeline({ query }: { query: FrameQuery }) {
  const { recording } = useDashboard();
  return recording.mode === 'light' ? (
    <p>
      Light captures contain aggregates. Namespace and function filters narrow
      this list; root-call and exact duration filters require a full recording.
    </p>
  ) : (
    <ExplorerTimeline query={query} selectable />
  );
}

function ExtensionSortHeading({
  column,
  direction,
  onSort,
  sort,
}: {
  column: NonNullable<CoreDashboardExtensions['functionColumns']>[number];
  direction: number;
  onSort: (key: SortKey) => void;
  sort: SortKey;
}) {
  return column.sortValue ? (
    <SortHeading
      column={`extension:${column.id}`}
      direction={direction}
      label={column.label}
      onSort={onSort}
      sort={sort}
    />
  ) : (
    <th>{column.label}</th>
  );
}

function FunctionDrilldown({
  item,
  labeled = false,
}: {
  item: CoreFunctionStat;
  labeled?: boolean;
}) {
  const { navigation, traceDataExcluded } = useDashboard();
  if (traceDataExcluded) {
    return null;
  }
  return (
    <button
      aria-label={`Explore calls to ${item.name}`}
      className={
        labeled ? 'cd-button cd-primary cd-drilldown-button' : 'cd-icon-button'
      }
      onClick={() =>
        navigation?.onChange({
          name: item.name,
          namespace: item.namespace,
          page: 'frames',
          tree: 'matches',
        })
      }
      title="Explore individual calls"
    >
      {labeled && <span>Explore individual calls</span>}
      <DashboardIcon name="arrow-up-right" />
    </button>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  return (
    <svg
      aria-hidden="true"
      className={`cd-severity-icon cd-severity-${severity}`}
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.6"
      viewBox="0 0 20 20"
      width="16"
    >
      {severity === 'warning' ? (
        <path d="M10 2 19 18H1Z" />
      ) : (
        <circle cx="10" cy="10" r="8" />
      )}
      <path d="M10 6v5m0 2v1" />
    </svg>
  );
}

function failedCallsOnly(context: ReturnType<typeof useDashboard>) {
  return context.navigation?.state.kind === 'error';
}
function FunctionStatus({
  empty,
  error,
  loading,
}: {
  empty: boolean;
  error?: string;
  loading: boolean;
}) {
  if (loading) {
    return null;
  }
  if (error || !empty) {
    return null;
  }
  return (
    <EmptyState
      detail="Adjust the function or namespace filter."
      title="No functions match"
    />
  );
}

function functionCountLabel(loading: boolean, count: number) {
  return loading ? 'Loading…' : `${count.toLocaleString()} functions`;
}
function functionDescription(mode: string | undefined) {
  return mode === 'light'
    ? 'Search and sort aggregate calls.'
    : 'Search and sort calls. Filter by a root to isolate one flow.';
}

function summaryMetadata(summary?: SessionSummary) {
  return {
    browser: summary?.browser,
    traceDataExcluded: summary?.traceDataExcluded,
  };
}
function functionColumns(extensions?: CoreDashboardExtensions) {
  return extensions?.functionColumns ?? [];
}
