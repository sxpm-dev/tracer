import { useEffect, useMemo, useRef, useState } from 'react';

import type { LocalRecordingSummary } from './types';

import { DashboardSidebar } from './CoreRecordingDashboard';
import { DashboardIcon } from './DashboardIcon';
import { DashboardShell } from './DashboardShell';
import {
  buildPerformanceReport,
  createSingleSessionConfig,
  type PerformanceReportConfig,
  type PerformanceReportData,
  type ReportEvidence,
} from './performanceReport';
import { renderPerformanceReport } from './reportHtml';
import { createSessionClient } from './sessionData';
import { useDashboardTheme } from './theme';

type ReportSessionChoice = Partial<Pick<LocalRecordingSummary, 'startedAt'>> &
  Pick<LocalRecordingSummary, 'mode' | 'sessionId' | 'title'>;

export function createComparisonConfig(
  selected: ReportSessionChoice[],
): PerformanceReportConfig {
  const sessions = [...selected].sort((left, right) =>
    (left.startedAt ?? '').localeCompare(right.startedAt ?? ''),
  );
  if (sessions.length === 1) {
    return createSingleSessionConfig(sessions[0].sessionId, sessions[0].title);
  }
  const checkpoints = sessions.map((session, index) => ({
    id: `checkpoint-${index + 1}`,
    name:
      index === 0
        ? 'Baseline'
        : sessions.length === 2
          ? 'Comparison'
          : `Recording ${index + 1}`,
  }));
  return {
    scenarios: [
      {
        baselineCheckpointId: checkpoints[0].id,
        checkpoints,
        id: 'comparison',
        name: 'Comparison',
        sessions: Object.fromEntries(
          checkpoints.map((checkpoint, index) => [
            checkpoint.id,
            sessions[index].sessionId,
          ]),
        ),
      },
    ],
    title: 'Performance comparison',
    version: 1,
  };
}

function downloadReport(html: string): void {
  const url = URL.createObjectURL(
    new Blob([html], { type: 'text/html;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'performance-report.html';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function PerformanceReportBuilder({
  initialSessions,
  onBack,
  serverUrl,
}: {
  initialSessions: ReportSessionChoice[];
  onBack: () => void;
  serverUrl: string;
}) {
  const { theme, toggleTheme } = useDashboardTheme();
  const operation = useRef<AbortController>();
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<null | PerformanceReportData>(null);
  const [progress, setProgress] = useState('Preparing report…');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const preview = useMemo(
    () => (report ? renderPerformanceReport(report, theme) : ''),
    [report, theme],
  );
  const config = useMemo(
    () => createComparisonConfig(initialSessions),
    [initialSessions],
  );
  useEffect(() => {
    const abort = new AbortController();
    operation.current = abort;
    const generate = async () => {
      setBusy(true);
      setError('');
      setReport(null);
      setProgress('Preparing report…');
      const client = createSessionClient(serverUrl);
      const ids = [...new Set(Object.values(config.scenarios[0].sessions))];
      const evidence: ReportEvidence[] = [];
      try {
        for (const [index, id] of ids.entries()) {
          setProgress(`Preparing recording ${index + 1} of ${ids.length}`);
          try {
            evidence.push(
              await client.reportEvidence(id, abort.signal, (fraction) =>
                setProgress(
                  `Preparing recording ${index + 1} of ${ids.length} · ${Math.round(fraction * 100)}%`,
                ),
              ),
            );
          } catch (failure) {
            if (abort.signal.aborted) {
              throw failure;
            }
            if (String(failure).includes('(404)')) {
              throw new Error(
                `Could not prepare ${id}. The recording may have been removed, or the recording server needs a restart to support reports.`,
              );
            }
            throw new Error(`Could not prepare ${id}: ${String(failure)}`);
          }
        }
        abort.signal.throwIfAborted();
        setProgress('Rendering report');
        setReport(buildPerformanceReport(config, evidence));
        setProgress('Report ready');
      } catch (failure) {
        if (!abort.signal.aborted) {
          setError(String(failure));
          setProgress('Generation failed');
        }
      } finally {
        if (operation.current === abort) {
          setBusy(false);
        }
      }
    };
    void generate();
    return () => abort.abort();
  }, [config, revision, serverUrl]);

  return (
    <DashboardShell
      sidebar={
        <DashboardSidebar
          findings={0}
          navigation={[]}
          onHome={onBack}
          onSection={() => undefined}
          onTheme={toggleTheme}
          section="sessions"
          theme={theme}
        />
      }
      theme={theme}
      toolbar={
        <header className="cd-toolbar cd-report-toolbar">
          <div className="cd-breadcrumb">
            <button onClick={onBack}>
              <DashboardIcon name="arrow-left" size={13} /> Sessions
            </button>
            <span>/</span>
            <strong>Performance report</strong>
          </div>
          <button
            className="cd-button primary"
            disabled={!preview || busy}
            onClick={() => downloadReport(preview)}
          >
            Download HTML
          </button>
        </header>
      }
    >
      <section className="cd-report-page">
        <div
          className={`cd-report-preview-toolbar${preview ? ' is-ready' : ''}`}
        >
          <span role="status">{progress}</span>
          {busy && (
            <button
              className="cd-button"
              onClick={() => {
                operation.current?.abort();
                setBusy(false);
                setProgress('Cancelled');
              }}
            >
              Cancel
            </button>
          )}
          {!busy && !preview && (
            <button
              className="cd-button primary"
              onClick={() => setRevision((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
        {error && (
          <div className="cd-report-error" role="alert">
            <strong>Could not generate the report</strong>
            <p>{error}</p>
          </div>
        )}
        {preview ? (
          <iframe
            className="cd-report-frame"
            srcDoc={preview}
            title="Performance report preview"
          />
        ) : (
          <div className="cd-report-loading">
            <span aria-hidden="true" className="cd-report-spinner" />
            <strong>Building your report</strong>
            <p>
              Preparing indexed recording evidence. Large recordings may take a
              moment the first time.
            </p>
          </div>
        )}
      </section>
    </DashboardShell>
  );
}
