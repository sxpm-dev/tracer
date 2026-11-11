import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TraceRecording } from '../src/types';

import { analyzeCoreRecording } from '../src/coreAnalysis';
import { DashboardApp } from '../src/DashboardApp';
import { dashboardRouteUrl, parseDashboardRoute } from '../src/navigation';
import { PreparationStatus } from '../src/PreparationStatus';
import { createSessionClient } from '../src/sessionData';

const recording: TraceRecording = {
  duration: 20,
  releasedAt: '',
  schemaVersion: 1,
  sessionId: 'saved',
  startedAt: '2026-09-25T10:00:00Z',
  status: 'complete',
  title: 'Resize canvas',
  traces: [],
};
const summary = {
  analysis: analyzeCoreRecording(recording),
  browser: { functions: Array.from({ length: 48 }, () => []), series: [] },
  recording,
};
let requests: { signal?: AbortSignal; url: string }[];
beforeEach(() => {
  window.history.replaceState(null, '', '/');
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      requests.push({ signal: options?.signal as AbortSignal, url: input });
      if (input.endsWith('/api/recordings')) {
        return {
          json: async () => [
            {
              ...recording,
              bytes: 8000,
              eventCount: 12,
              traceCount: 2,
              updatedAt: recording.startedAt,
            },
          ],
          ok: true,
        };
      }
      if (input.includes('/analytics?')) {
        return {
          json: async () => ({
            bucketMs: 1000,
            chartCounts: Array<number>(48).fill(0),
            chartRootCounts: Array<number>(48).fill(0),
            counts: [0],
            functions: [],
            rootTotal: 0,
            total: 0,
          }),
          ok: true,
        };
      }
      if (input.includes('/progress?')) {
        return {
          json: async () => ({
            bytes: 500,
            phase: 'Extracting events',
            totalBytes: 1000,
          }),
          ok: true,
        };
      }
      if (input.includes('/summary?')) {
        return { json: async () => summary, ok: true };
      }
      if (input.includes('/rays?')) {
        return {
          json: async () => ({
            items: [
              {
                calls: 1,
                duration: 10,
                errors: 0,
                name: 'resize',
                ray: 'ray-1',
                startedAt: 0,
              },
            ],
            offset: 0,
            total: 1,
          }),
          ok: true,
        };
      }
      if (input.includes('/frames?')) {
        const frame = {
          at: 0,
          duration: 10,
          id: 7,
          kind: 'call',
          name: 'resize',
          namespace: 'app',
          ray: 'ray-1',
        };
        return {
          json: async () => ({
            items: [frame],
            offset: 0,
            selected: input.includes('frame=7')
              ? { ...frame, arguments: ['selected-payload'] }
              : undefined,
            total: 1,
          }),
          ok: true,
        };
      }
      throw new Error(`Unexpected full-data request: ${input}`);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function pop(url: string) {
  act(() => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}
describe('dashboard application navigation', () => {
  it('reports extraction progress and cancels polling when unmounted', async () => {
    const result = render(
      <PreparationStatus client={createSessionClient()} sessionId="saved" />,
    );
    await screen.findByText(/50%/);
    expect(screen.getByRole('progressbar').getAttribute('value')).toBe('500');
    result.unmount();
    expect(
      requests.find((item) => item.url.includes('/progress?'))?.signal?.aborted,
    ).toBe(true);
  });
  it('loads sessions automatically, navigates with links and restores URL state on history changes', async () => {
    render(<DashboardApp />);
    fireEvent.click(await screen.findByRole('link', { name: /Resize canvas/ }));
    expect(window.location.pathname).toBe('/sessions/saved/overview');
    await screen.findByText('Recording timeline');
    fireEvent.click(screen.getByRole('link', { name: 'Functions' }));
    expect(window.location.pathname).toBe('/sessions/saved/functions');
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Filter functions' }),
      { target: { value: 'render' } },
    );
    expect(window.location.search).toContain('frameQuery=render');
    pop('/sessions/saved/overview');
    await screen.findByText('Recording timeline');
    pop('/sessions/saved/functions?frameQuery=resize');
    await waitFor(() =>
      expect(
        (
          screen.getByRole('combobox', {
            name: 'Filter functions',
          }) as HTMLInputElement
        ).value,
      ).toBe('resize'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    expect(window.location.pathname).toBe('/');
    await screen.findByRole('link', { name: /Resize canvas/ });
    expect(
      requests.every(
        (request) =>
          request.url.endsWith('/api/recordings') ||
          request.url.includes('/summary?') ||
          request.url.includes('/analytics?') ||
          request.url.includes('/progress?'),
      ),
    ).toBe(true);
    expect(
      requests.find((request) => request.url.includes('/summary?'))?.signal
        ?.aborted,
    ).toBe(true);
  });
  it('opens a selected frame directly, keeps selection in the URL, and aborts frame work when leaving', async () => {
    window.history.replaceState(
      null,
      '',
      '/sessions/saved/frames?ray=ray-1&frame=7',
    );
    render(<DashboardApp />);
    await screen.findByText(/selected-payload/);
    expect(
      requests.some(
        (request) =>
          request.url.includes('/frames?') && request.url.includes('frame=7'),
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Overview' }));
    await screen.findByText('Recording timeline');
    expect(screen.queryByText(/selected-payload/)).toBeNull();
    expect(
      requests
        .filter((request) => request.url.includes('/frames?'))
        .every((request) => request.signal?.aborted),
    ).toBe(true);
  });
  it('gives additional pages shareable URLs and identifies metadata-only recordings to extensions', async () => {
    const { useDashboard } = await import('../src/extensions');
    function ExtraPage() {
      const context = useDashboard();
      return <p>Extension scope: {context.dataScope}</p>;
    }
    window.history.replaceState(null, '', '/sessions/saved/editor');
    render(
      <DashboardApp
        extensions={{
          additionalPages: [
            {
              component: ExtraPage,
              id: 'editor',
              label: 'Editor',
              subtitle: 'Editor analytics',
            },
          ],
        }}
      />,
    );
    await screen.findByText('Extension scope: summary');
    expect(
      screen.getByRole('link', { name: 'Editor' }).getAttribute('href'),
    ).toBe('/sessions/saved/editor');
  });
  it('opens imported recordings without requests and restores local history', async () => {
    render(<DashboardApp initialRecording={recording} />);
    expect(window.location.pathname).toBe('/local/overview');
    fireEvent.click(screen.getByRole('link', { name: 'Functions' }));
    expect(window.location.pathname).toBe('/local/functions');
    pop('/local/overview');
    await screen.findByText('Recording timeline');
    expect(requests).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'All sessions' }));
    await screen.findByRole('link', { name: /Resize canvas/ });
    pop('/local/overview');
    await screen.findByText('Reopen the imported recording');
  });
  it('redirects browser recordings away from function-only URLs', async () => {
    window.history.replaceState(null, '', '/local/functions');
    render(
      <DashboardApp initialRecording={{ ...recording, mode: 'browser' }} />,
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe('/local/overview'),
    );
    expect(screen.getByText('Browser signals only')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Functions' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Trace frames' })).toBeNull();
  });
  it('shows and clears a legacy function query in the visible filter', async () => {
    window.history.replaceState(
      null,
      '',
      '/sessions/saved/functions?query=app.render',
    );
    render(<DashboardApp />);
    const filter = (await screen.findByRole('combobox', {
      name: 'Filter functions',
    })) as HTMLInputElement;
    expect(filter.value).toBe('app.render');

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear function filter' }),
    );
    expect(filter.value).toBe('');
    expect(window.location.search).toBe('');

    fireEvent.change(filter, { target: { value: 'resize' } });
    expect(window.location.search).toBe('?frameQuery=resize');
    fireEvent.change(filter, { target: { value: '' } });
    expect(window.location.search).toBe('');
    fireEvent.change(filter, { target: { value: 'resize' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(filter.value).toBe('');
    expect(window.location.search).toBe('');
  });
  it('reports a missing session with a route back to the workspace', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    window.history.replaceState(null, '', '/sessions/missing/overview');
    render(<DashboardApp />);
    await screen.findByText(/no longer available/);
    expect(screen.getByRole('button', { name: 'All sessions' })).toBeTruthy();
  });
  it('encodes custom page and ray values and ignores invalid numeric state', () => {
    const route = {
      kind: 'session' as const,
      sessionId: 'test',
      view: { bucket: 4, frame: 0, page: 'editor/info', ray: 'a&b' },
    };
    expect(parseDashboardRoute(dashboardRouteUrl(route))).toMatchObject(route);
    const report = {
      kind: 'report' as const,
      sessionIds: ['first', 'second & third'],
      view: { page: 'overview' },
    };
    expect(parseDashboardRoute(dashboardRouteUrl(report))).toMatchObject(
      report,
    );
    expect(
      parseDashboardRoute('/sessions/test/frames?frame=-1&frameOffset=Infinity')
        .view.frame,
    ).toBeUndefined();
    expect(parseDashboardRoute('/unrelated').kind).toBe('missing');
  });
});

it('notifies consumers of initial, navigated and restored projection filters', async () => {
  const onRouteChange = vi.fn();
  render(<DashboardApp onRouteChange={onRouteChange} />);
  await waitFor(() =>
    expect(onRouteChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'home' }),
    ),
  );
  fireEvent.click(await screen.findByRole('link', { name: /Resize canvas/ }));
  await waitFor(() =>
    expect(onRouteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: 'saved',
        view: expect.objectContaining({ page: 'overview' }),
      }),
    ),
  );
  pop('/sessions/saved/functions?namespace=platform&from=2&to=10');
  await waitFor(() =>
    expect(onRouteChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: 'saved',
        view: expect.objectContaining({
          from: 2,
          namespace: 'platform',
          page: 'functions',
          to: 10,
        }),
      }),
    ),
  );
});

it('opens the complete sample directly without requesting saved recording data', async () => {
  window.history.replaceState(null, '', '/sample/full/overview');
  render(<DashboardApp />);
  expect(await screen.findByText('Runtime on the same clock')).toBeTruthy();
  expect(screen.getAllByText('CPU pressure').length).toBeGreaterThan(0);
  expect(screen.getAllByText('JavaScript heap').length).toBeGreaterThan(0);
  expect(requests).toEqual([]);
});

it('offers full and lightweight sample links on the sessions screen', async () => {
  render(<DashboardApp />);
  expect(
    screen.getByRole('link', { name: 'Open sample data' }).getAttribute('href'),
  ).toBe('/sample/full/overview');
  expect(
    screen
      .getByRole('link', { name: 'Lightweight sample' })
      .getAttribute('href'),
  ).toBe('/sample/light/overview');
  await waitFor(() => expect(requests.length).toBeGreaterThan(0));
});
