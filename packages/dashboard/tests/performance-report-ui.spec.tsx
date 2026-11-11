import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { TextDecoder } from 'node:util';
import { afterEach, expect, it, vi } from 'vitest';

import type { ReportEvidence } from '../src/performanceReport';

import {
  createComparisonConfig,
  PerformanceReportBuilder,
} from '../src/PerformanceReportBuilder';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('generates a session report on open without asking for setup', async () => {
  const evidence: ReportEvidence = {
    blockingCount: null,
    blockingMs: null,
    browser: [],
    cache: [],
    calculationVersion: 1,
    coverageNotes: [],
    durationMs: 1000,
    functions: [],
    mode: 'full',
    sessionId: 'fixture',
    startedAt: '2026-09-26T00:00:00Z',
    status: 'complete',
    title: 'Fixture',
  };
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/api/recordings')
      ? Response.json([
          { mode: 'full', sessionId: 'fixture', title: 'Fixture' },
        ])
      : new Response(`${JSON.stringify({ snapshot: evidence })}\n`, {
          headers: { 'content-type': 'application/x-ndjson' },
        }),
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('TextDecoder', TextDecoder);
  const { container } = render(
    <PerformanceReportBuilder
      initialSessions={[
        { mode: 'full', sessionId: 'fixture', title: 'Fixture' },
      ]}
      onBack={() => undefined}
      serverUrl="http://localhost:4178"
    />,
  );
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('Report ready'),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:4178/api/recordings/fixture/report-evidence',
    expect.anything(),
  );
  expect(container.querySelector('input,textarea,select')).toBeNull();
  expect(container.querySelector('dialog')).toBeNull();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: 'Download HTML' })
      .disabled,
  ).toBe(false);
  expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
    'At a glance',
  );
  expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
    '<h1>Fixture</h1>',
  );
  expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
    'data-theme="light"',
  );
});

it('shows an error when a selected recording cannot provide report evidence', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Not found', { status: 404 })),
  );
  const { container } = render(
    <PerformanceReportBuilder
      initialSessions={[
        { mode: 'full', sessionId: 'fixture', title: 'Fixture' },
      ]}
      onBack={() => undefined}
      serverUrl="http://localhost:4178"
    />,
  );
  expect((await screen.findByRole('alert')).textContent).toContain(
    'recording server needs a restart',
  );
  expect(container.querySelector('iframe')).toBeNull();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
});

it('uses the oldest selected recording as the comparison baseline', () => {
  const config = createComparisonConfig([
    {
      mode: 'full',
      sessionId: 'new',
      startedAt: '2026-09-27T00:00:00Z',
      title: 'Candidate',
    },
    {
      mode: 'full',
      sessionId: 'old',
      startedAt: '2026-09-26T00:00:00Z',
      title: 'Before',
    },
  ]);
  expect(
    config.scenarios[0].sessions[config.scenarios[0].baselineCheckpointId],
  ).toBe('old');
  expect(config.scenarios[0].checkpoints.map((item) => item.name)).toEqual([
    'Baseline',
    'Comparison',
  ]);
});
