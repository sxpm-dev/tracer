import { describe, expect, it } from 'vitest';

import type { TraceRecording } from '../src/types';

import { createStandaloneHtmlBlob } from '../src/standalone';

describe('standalone trace report', () => {
  it('embeds summaries without trace payloads and the interactive viewer in one HTML file', async () => {
    const recording: TraceRecording = {
      duration: 100,
      releasedAt: '2026-09-17T00:00:00.100Z',
      schemaVersion: 1,
      sessionId: 'portable-session',
      startedAt: '2026-09-17T00:00:00.000Z',
      traces: [
        {
          events: [
            {
              arguments: [{ html: '</script><main>unsafe</main>' }],
              at: 1,
              duration: 5,
              id: 1,
              kind: 'call',
              name: 'Manifest.resolve',
              ray: 'ray-1',
              status: 'ok',
            },
          ],
          ray: 'ray-1',
        },
      ],
    };
    const progress: number[] = [];

    const blob = await createStandaloneHtmlBlob(
      recording,
      (value) => progress.push(value),
      {
        css: '.dashboard { color: lime; }',
        javascript:
          'document.title = "Manifest Analytics"; console.log("</script>");',
      },
    );
    const html = await readBlob(blob);

    expect(html).toContain('<!doctype html>');
    expect(html).toMatch(/<div id="root"[^>]*><\/div>/);
    expect(html).toContain('.dashboard { color: lime; }');
    expect(html).toContain('id="dashboard-application"');
    expect(html).toContain('document.title = "Manifest Analytics";');
    expect(html).toContain('<\\/script>');
    expect(html).not.toContain('Standalone Trace Report');
    expect(html).toContain('portable-session');
    expect(html).toContain('Manifest.resolve');
    expect(html).not.toContain('unsafe');
    expect(html).not.toContain('arguments');
    expect(html).toContain('dashboard-snapshot');
    expect(html).toContain('traceDataExcluded');
    expect(html).not.toContain('</script><main>unsafe</main>');
    expect(progress.at(-1)).toBe(1);
  });
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}
