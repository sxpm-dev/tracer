import { useEffect, useState } from 'react';

import type { PreparationProgress, SessionClient } from './sessionData';

export function PreparationStatus({
  client,
  sessionId,
}: {
  client: SessionClient;
  sessionId: string;
}) {
  const [progress, setProgress] = useState<PreparationProgress>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await client.progress(sessionId, controller.signal);
        if (!controller.signal.aborted) {
          setProgress(next);
        }
      } catch {
        /* The summary request owns error reporting. */
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(() => void poll(), 500);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client, sessionId]);
  return <ProgressReadout progress={progress} />;
}
function ProgressReadout({
  progress = { bytes: 0, phase: 'Waiting to prepare', totalBytes: 0 },
}: {
  progress?: PreparationProgress;
}) {
  const extracting = progress.phase === 'Extracting events';
  return (
    <div className="cd-preparation" role="status">
      <strong>{progress.phase ?? 'Preparing recording'}</strong>
      <progress
        aria-label="Recording preparation"
        max={progress.totalBytes || 1}
        value={extracting ? progress.bytes : undefined}
      />
      {Boolean(progress.totalBytes) && (
        <span>
          {((progress.bytes ?? 0) / 1048576).toFixed(1)} /{' '}
          {((progress.totalBytes ?? 0) / 1048576).toFixed(1)} MB extracted
          {extracting
            ? ` · ${Math.round((100 * progress.bytes) / progress.totalBytes)}%`
            : ''}
        </span>
      )}
      <small>
        Extraction is followed by search indexing and analytics. You can return
        to sessions at any time.
      </small>
    </div>
  );
}
