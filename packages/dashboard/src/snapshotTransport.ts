import type { StandaloneSnapshot } from './standaloneSnapshot';

/** Progress and the completed projection share a single cancellable response. */
export async function fetchSnapshot<T = StandaloneSnapshot>(
  url: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Could not export session (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fragments: string[] = [];
  let snapshot: T | undefined;
  const consume = (line: string) => {
    if (!line.trim()) {
      return;
    }
    const message = JSON.parse(line) as {
      progress?: { completed: number; total: number };
      snapshot?: T;
    };
    if (message.progress) {
      onProgress?.(
        message.progress.completed / Math.max(1, message.progress.total),
      );
    }
    if (message.snapshot) {
      snapshot = message.snapshot;
    }
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const lines = decoder.decode(value, { stream: true }).split('\n');
      for (let i = 0; i < lines.length - 1; i++) {
        fragments.push(lines[i]);
        consume(fragments.join(''));
        fragments = [];
      }
      fragments.push(lines[lines.length - 1]);
    }
    fragments.push(decoder.decode());
    consume(fragments.join(''));
    signal?.throwIfAborted();
    if (!snapshot) {
      throw new Error('The export ended before the dashboard was complete.');
    }
    return snapshot;
  } finally {
    reader.releaseLock();
  }
}
