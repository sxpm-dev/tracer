import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardViewState } from '../src/navigation';
import type { TraceRecording } from '../src/types';

import { AnalyticsChart } from '../src/AnalyticsChart';
import { CoreRecordingDashboard } from '../src/CoreRecordingDashboard';
import { createLocalSessionClient } from '../src/localSessionClient';

const recording: TraceRecording = {
  duration: 200,
  releasedAt: '',
  schemaVersion: 1,
  sessionId: 'interactions',
  startedAt: '',
  traces: [
    {
      events: [
        {
          at: 0,
          duration: 120,
          id: 1,
          kind: 'call',
          name: 'render',
          namespace: 'app',
          ray: 'root',
          status: 'error',
        },
        {
          at: 2,
          duration: 4,
          id: 2,
          kind: 'call',
          name: 'measure',
          namespace: 'app',
          parent: 1,
          ray: 'root',
          status: 'ok',
        },
      ],
      ray: 'root',
    },
  ],
};
const noop = () => undefined;
function selectTimelineRange(from: number, to: number) {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const plot = document.querySelector('.cd-explorer-timeline .cd-chart-plot');
  if (!plot) {
    throw new Error('Timeline chart was not found');
  }
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: recording.duration,
  } as DOMRect);
  fireEvent.pointerDown(plot, { button: 0, clientX: from });
  fireEvent.pointerMove(plot, { clientX: to });
  fireEvent.pointerUp(plot, { clientX: to });
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('analytics interactions', () => {
  it('groups repeated paths in imported recordings', async () => {
    const client = createLocalSessionClient({
      ...recording,
      traces: [
        {
          events: [
            { ...recording.traces[0].events[0], name: 'bar' },
            { ...recording.traces[0].events[1], name: 'foo' },
            { ...recording.traces[0].events[1], id: 3, name: 'foo' },
            {
              ...recording.traces[0].events[1],
              id: 4,
              name: 'foo',
              parent: undefined,
            },
            {
              ...recording.traces[0].events[1],
              id: 5,
              kind: 'marker',
              name: 'checkpoint',
            },
            { ...recording.traces[0].events[1], id: 6, name: 'foo', parent: 5 },
          ],
          ray: 'root',
        },
      ],
    });
    expect(
      (await client.callPaths('interactions', { name: 'foo' })).map((path) => ({
        calls: path.calls,
        names: path.frames.map((frame) => frame.name),
      })),
    ).toEqual([
      { calls: 2, names: ['bar', 'foo'] },
      { calls: 1, names: ['bar', 'checkpoint', 'foo'] },
      { calls: 1, names: ['foo'] },
    ]);
    const paths = await client.callPaths('interactions', { name: 'foo' });
    expect(
      paths.find((path) =>
        path.frames.some((frame) => frame.name === 'checkpoint'),
      )?.frames[1].kind,
    ).toBe('marker');
  });
  it('shows the counted call path between timing and browser signals', async () => {
    const [renderCall, measureCall] = recording.traces[0].events;
    const withMarker: TraceRecording = {
      ...recording,
      traces: [
        {
          events: [
            renderCall,
            {
              ...measureCall,
              id: 3,
              kind: 'marker',
              name: 'checkpoint',
            },
            { ...measureCall, parent: 3 },
          ],
          ray: 'root',
        },
      ],
    };
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={withMarker}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect app.measure' }),
    );
    const drawer = screen.getByRole('dialog', { name: 'measure' });
    const grouping = within(drawer).getByRole('checkbox', {
      name: 'Group by stack',
    }) as HTMLInputElement;
    expect(grouping.checked).toBe(true);
    fireEvent.click(grouping);
    const paths = await within(drawer).findByText('1 call');
    const path = paths.closest('li');
    expect(path?.querySelectorAll('.cd-call-path-part')).toHaveLength(3);
    expect(path?.querySelectorAll('.cd-namespace')).toHaveLength(3);
    expect(path?.querySelectorAll('.cd-trace-kind.is-call')).toHaveLength(2);
    expect(path?.querySelectorAll('.cd-trace-kind.is-marker')).toHaveLength(1);
    expect(path?.textContent).toContain('render');
    expect(path?.textContent).toContain('checkpoint');
    expect(path?.textContent).toContain('measure');
    const sections = [
      ...drawer.querySelectorAll('.cd-explorer-timeline details summary'),
    ];
    expect(sections.map((section) => section.textContent)).toEqual([
      'Call paths',
      'Browser signals · memory, rendering and responsiveness',
    ]);
    expect(
      within(drawer).getByRole('button', { name: 'About Calls over time' }),
    ).toBeTruthy();
    expect(
      within(drawer).getByRole('button', { name: 'About Call paths' }),
    ).toBeTruthy();
  });
  it('groups shared ancestors with cumulative counts and expandable rows', async () => {
    const root = recording.traces[0].events[0];
    const call = recording.traces[0].events[1];
    const groupedRecording: TraceRecording = {
      ...recording,
      traces: [
        {
          events: [
            { ...root, name: 'bar' },
            { ...call, name: 'baz' },
            { ...call, id: 3, name: 'foo', parent: 2 },
            { ...call, id: 4, name: 'foo', parent: 2 },
            { ...call, id: 5, name: 'foo', parent: 1 },
            { ...root, id: 6, name: 'other' },
            { ...call, id: 7, name: 'foo', parent: 6 },
          ],
          ray: 'root',
        },
      ],
    };
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={groupedRecording}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect app.foo' }),
    );
    const drawer = screen.getByRole('dialog', { name: 'foo' });
    const table = await within(drawer).findByRole('table', {
      name: 'Grouped call paths',
    });
    const barRow = within(table)
      .getByRole('button', { name: 'Collapse bar' })
      .closest('tr');
    expect(barRow?.querySelector('.cd-call-path-tree-count')?.textContent).toBe(
      '3',
    );
    expect(barRow?.textContent).toContain('2 paths');
    expect(within(table).getByText('Calls through')).toBeTruthy();
    expect(
      within(drawer).getByText(/Shared caller chains appear once/),
    ).toBeTruthy();
    expect(within(table).getByText('baz')).toBeTruthy();
    fireEvent.click(
      within(table).getByRole('button', { name: 'Collapse bar' }),
    );
    expect(within(table).queryByText('baz')).toBeNull();
    fireEvent.click(within(table).getByRole('button', { name: 'Expand bar' }));
    expect(within(table).getByText('baz')).toBeTruthy();

    fireEvent.click(
      within(drawer).getByRole('checkbox', { name: 'Group by stack' }),
    );
    expect(
      within(drawer).queryByRole('table', { name: 'Grouped call paths' }),
    ).toBeNull();
    const paths = drawer.querySelectorAll('.cd-call-path-list li');
    expect(paths).toHaveLength(3);
    expect(paths[0].textContent).toContain('2 calls');
  });
  it('shows a spinner while call paths load', async () => {
    const local = createLocalSessionClient(recording);
    let releasePaths: (() => void) | undefined;
    const sessionClient = {
      ...local,
      callPaths: async (...args: Parameters<typeof local.callPaths>) => {
        await new Promise<void>((resolve) => {
          releasePaths = resolve;
        });
        return local.callPaths(...args);
      },
    };
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
        sessionClient={sessionClient}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect app.measure' }),
    );
    const drawer = screen.getByRole('dialog', { name: 'measure' });
    const loading = within(drawer).getByRole('status', {
      name: 'Loading call paths',
    });
    expect(loading.querySelector('.cd-spinner')).toBeTruthy();
    await act(async () => releasePaths?.());
    expect(within(drawer).queryByText('Loading call paths…')).toBeNull();
    expect(
      within(drawer).getByRole('table', { name: 'Grouped call paths' }),
    ).toBeTruthy();
  });
  it('shows one-second root and all-call totals on the overview timeline', async () => {
    const { container } = render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={{ ...recording, duration: 2_200 }}
      />,
    );
    await act(async () => undefined);
    const plot = container.querySelector('.cd-timeline-card .cd-chart-plot');
    expect(plot).not.toBeNull();
    fireEvent.focus(
      within(plot as HTMLElement).getByRole('button', {
        name: 'Select time slice 1',
      }),
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('0 μs — 1.00 s');
    expect(tooltip.textContent).toContain('Root calls1');
    expect(tooltip.textContent).toContain('All calls2');
    expect(tooltip.textContent).not.toContain('calls/s');
    fireEvent.focus(
      within(plot as HTMLElement).getByRole('button', {
        name: 'Select time slice 3',
      }),
    );
    expect(screen.getByRole('tooltip').textContent).toContain(
      '2.00 s — 2.20 s (partial second)',
    );
  });

  it('filters light capture aggregates by namespace and function', async () => {
    const lightRecording: TraceRecording = {
      ...recording,
      aggregates: [
        {
          calls: 10,
          errors: 1,
          maxDuration: 120,
          minDuration: 1,
          name: 'render',
          namespace: 'app',
          totalDuration: 200,
        },
        {
          calls: 20,
          errors: 0,
          maxDuration: 80,
          minDuration: 2,
          name: 'render',
          namespace: 'other',
          totalDuration: 300,
        },
      ],
      duration: 2_000,
      functionWindows: [
        {
          at: 0,
          functions: [
            {
              calls: 10,
              errors: 1,
              maxDuration: 120,
              name: 'render',
              namespace: 'app',
              totalDuration: 200,
            },
            {
              calls: 20,
              errors: 0,
              maxDuration: 80,
              name: 'render',
              namespace: 'other',
              totalDuration: 300,
            },
          ],
          otherCalls: 0,
          otherDuration: 0,
          span: 2_000,
        },
      ],
      mode: 'light',
      traces: [],
    };
    const sessionClient = createLocalSessionClient(lightRecording);
    const analytics = vi.spyOn(sessionClient, 'analytics');
    function Dashboard() {
      const [view, setView] = useState<DashboardViewState>({
        page: 'functions',
      });
      return (
        <CoreRecordingDashboard
          navigation={{ onChange: setView, state: view }}
          onCompare={noop}
          onOpen={noop}
          onRefresh={noop}
          recording={lightRecording}
          sessionClient={sessionClient}
        />
      );
    }
    render(<Dashboard />);
    await act(async () => undefined);
    expect(
      screen.getByRole('button', { name: 'Inspect app.render' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Inspect other.render' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('checkbox', { name: 'Root calls only' }),
    ).toBeNull();
    expect(
      screen.queryByRole('spinbutton', { name: 'Minimum duration (ms)' }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Namespace: All namespaces' }),
    );
    fireEvent.click(screen.getByRole('option', { name: 'app' }));
    expect(
      screen.getByRole('button', { name: 'Inspect app.render' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Inspect other.render' }),
    ).toBeNull();
    expect(analytics).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Filter functions' }),
      {
        target: { value: 'missing' },
      },
    );
    expect(
      screen.queryByRole('button', { name: 'Inspect app.render' }),
    ).toBeNull();
    expect(screen.getByText('No functions match')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(
      screen.getByRole('button', { name: 'Inspect other.render' }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Failed calls only' }),
    );
    expect(
      screen.getByRole('button', { name: 'Inspect app.render' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Inspect other.render' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(screen.getByText('Functions across recording')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Inspect other.render' }).closest('tr')
        ?.textContent,
    ).toContain('20');
    const plot = document.querySelector('.cd-timeline-card .cd-chart-plot');
    expect(plot).not.toBeNull();
    fireEvent.focus(
      within(plot as HTMLElement).getByRole('button', {
        name: 'Select time slice 2',
      }),
    );
    expect(screen.getByRole('tooltip').textContent).toContain(
      'Estimated all calls15',
    );
    expect(screen.getByRole('tooltip').textContent).toContain(
      'Root callsUnavailable in light capture',
    );
    expect(screen.getByRole('tooltip').textContent).not.toContain('calls/s');
    expect(analytics).not.toHaveBeenCalled();
  });

  it('keeps the inspector chart mounted while call timings load', async () => {
    // Buckets are one second wide, so the chart only has a line to draw when
    // calls land in more than one of them.
    const [renderCall] = recording.traces[0].events;
    const spanning: TraceRecording = {
      ...recording,
      duration: 2_200,
      traces: [
        {
          events: [
            ...recording.traces[0].events,
            { ...renderCall, at: 1_200, id: 10 },
          ],
          ray: 'root',
        },
      ],
    };
    const local = createLocalSessionClient(spanning);
    let releaseTimings: (() => void) | undefined;
    const sessionClient = {
      ...local,
      callPaths: async (...args: Parameters<typeof local.callPaths>) => {
        if (args[1].namespace === 'app') {
          await new Promise<void>((resolve) => {
            releaseTimings = resolve;
          });
        }
        return local.callPaths(...args);
      },
    };
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={spanning}
        sessionClient={sessionClient}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect app.render' }),
    );
    const drawer = screen.getByRole('dialog', { name: 'render' });
    const plot = drawer.querySelector('.cd-explorer-timeline .cd-chart-plot');
    expect(plot).not.toBeNull();
    expect(
      within(drawer).getByRole('status', { name: 'Loading call paths' }),
    ).toBeTruthy();
    expect(within(drawer).getByText('Loading call paths…')).toBeTruthy();
    expect(plot?.querySelector('polyline')).toBeNull();
    expect(plot?.querySelector('rect:not([fill="currentColor"])')).toBeNull();

    await act(async () => releaseTimings?.());
    await waitFor(() =>
      expect(
        within(drawer).queryByRole('status', { name: 'Loading call paths' }),
      ).toBeNull(),
    );
    // The point of the test: the same plot element survives the load rather
    // than being torn down and remounted, which would flash the chart.
    expect(drawer.querySelector('.cd-explorer-timeline .cd-chart-plot')).toBe(
      plot,
    );
    expect(
      within(drawer).getByRole('table', { name: 'Grouped call paths' }),
    ).toBeTruthy();
  });

  it('places exact call markers on the time axis without an unselected bucket guide', () => {
    const { container } = render(
      <AnalyticsChart
        duration={60000}
        markers={[{ at: 4, count: 1 }]}
        onSelect={noop}
        series={[
          { color: '#7460da', format: String, label: 'Calls', values: [2, 6] },
        ]}
      />,
    );
    const marker = container.querySelector(
      'line[vector-effect="non-scaling-stroke"]',
    );
    expect(Number(marker?.getAttribute('x1'))).toBeCloseTo((4 / 60000) * 1000);
    expect(container.querySelector('line[stroke-dasharray="4 4"]')).toBeNull();
    const slice = screen.getByRole('button', { name: 'Select time slice 2' });
    fireEvent.focus(slice);
    expect(
      container
        .querySelector('line[stroke-dasharray="4 4"]')
        ?.getAttribute('x1'),
    ).toBe('750');
    fireEvent.blur(slice);
    expect(container.querySelector('line[stroke-dasharray="4 4"]')).toBeNull();
  });

  it('shows exact chart tooltips with keyboard focus and toggles series', () => {
    render(
      <AnalyticsChart
        duration={100}
        onSelect={noop}
        selected={0}
        series={[
          { color: '#7460da', format: String, label: 'Calls', values: [2, 6] },
        ]}
      />,
    );
    fireEvent.focus(
      screen.getByRole('button', { name: 'Select time slice 2' }),
    );
    const tooltip = screen.getByRole('tooltip');
    expect(within(tooltip).getByText('6')).toBeTruthy();
    expect(tooltip.textContent).toContain('50.0 ms');
    fireEvent.click(screen.getByRole('button', { name: /Calls.*peak/ }));
    expect(
      screen
        .getByRole('button', { name: /Calls.*peak/ })
        .getAttribute('aria-pressed'),
    ).toBe('false');
  });
  it('distinguishes unsampled chart intervals from zero measurements', () => {
    render(
      <AnalyticsChart
        duration={100}
        onSelect={noop}
        selected={0}
        series={[
          {
            color: '#7460da',
            counts: [0, 1],
            format: String,
            label: 'FPS',
            values: [0, 60],
          },
        ]}
      />,
    );
    fireEvent.focus(
      screen.getByRole('button', { name: 'Select time slice 1' }),
    );
    expect(
      within(screen.getByRole('tooltip')).getByText('No samples'),
    ).toBeTruthy();
  });
  it('sorts function columns in both directions and drills into calls from an accessible drawer', async () => {
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    expect(screen.queryByText('Sort by')).toBeNull();
    expect(
      document.querySelector('line[stroke="var(--cd-call-marker, #be185d)"]'),
    ).toBeNull();
    const total = screen.getByRole('button', { name: /Total/ });
    fireEvent.click(total);
    expect(total.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(total);
    expect(total.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect app.render' }),
    );
    const drawer = screen.getByRole('dialog', { name: 'render' });
    await within(drawer).findByRole('checkbox', { name: 'Group by stack' });
    expect(within(drawer).getByText('Error rate')).toBeTruthy();
    fireEvent.click(
      within(drawer).getByRole('button', { name: 'Explore calls to render' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Inspect frame 1: render' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Inspect function app.render' }),
    ).toBeTruthy();
    const breadcrumbs = screen.getByRole('navigation', {
      name: 'Trace drilldown',
    });
    expect(
      within(breadcrumbs).getByRole('button', { exact: true, name: 'render' }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Drill into render #1' }),
    );
    await screen.findByRole('button', { name: 'Inspect frame 2: measure' });
    expect(
      within(breadcrumbs).getByRole('button', { name: 'render (root)' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { exact: true, name: 'Back' }));
    await screen.findByRole('button', { name: 'Drill into render #1' });
    expect(
      screen.queryByRole('button', { name: 'Inspect frame 2: measure' }),
    ).toBeNull();
  });
  it('filters function aggregates by selected time interval', async () => {
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    await screen.findByRole('button', { name: 'Inspect app.render' });
    selectTimelineRange(1, 3);
    await screen.findByRole('button', { name: 'Inspect app.measure' });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Inspect app.render' }),
      ).toBeNull(),
    );
  });

  it('shows root and all-frame totals for the recording and selected interval', async () => {
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trace frames' }));
    const totals = screen.getByRole('region', { name: 'Call totals' });
    await waitFor(() =>
      expect(totals.textContent).toContain('All frames 2 10 calls/s'),
    );
    expect(totals.textContent).toContain('Root calls 1 5 calls/s');
    fireEvent.focus(
      screen.getByRole('button', { name: 'Select time slice 1' }),
    );
    const tooltip = screen.getByRole('tooltip');
    // The recording is shorter than a bucket, so the slice is a partial
    // second and the tooltip reports counts without a per-second rate, which
    // would read as a much larger throughput than was observed.
    expect(tooltip.textContent).toContain('(partial second)');
    expect(tooltip.textContent).toContain('Root calls1');
    expect(tooltip.textContent).toContain('All frames2');
    expect(tooltip.textContent).not.toContain('calls/s');
    selectTimelineRange(1, 3);
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Call totals' }).textContent,
      ).toContain('All frames 1 500 calls/s'),
    );
    expect(
      screen.getByRole('region', { name: 'Call totals' }).textContent,
    ).toContain('Root calls 0 0 calls/s');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: 'Call totals' }).textContent,
      ).toContain('All frames 2 10 calls/s'),
    );
  });

  it('starts at roots, drills into children and restores the root breadcrumb', async () => {
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trace frames' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Explore root calls to app.render',
      }),
    );
    expect(
      screen.queryByRole('button', { name: 'Inspect frame 2: measure' }),
    ).toBeNull();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Drill into render #1' }),
    );
    await screen.findByRole('button', { name: 'Inspect frame 2: measure' });
    expect(
      screen.queryByRole('button', { name: /Expand children of measure/ }),
    ).toBeNull();
    expect(screen.queryByText('No child calls recorded')).toBeNull();
    expect(
      within(
        screen.getByRole('navigation', { name: 'Trace drilldown' }),
      ).getByRole('button', { name: 'render (root)' }),
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole('navigation', { name: 'Trace drilldown' }),
      ).getByRole('button', { exact: true, name: 'render' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All root traces' }));
    await screen.findByRole('button', {
      name: 'Explore root calls to app.render',
    });
    expect(
      screen.queryByRole('button', { name: 'Drill into render #1' }),
    ).toBeNull();
  });
  it('searches root functions from a call stack and resets its breadcrumbs on selection', async () => {
    const withAnotherRoot: TraceRecording = {
      ...recording,
      traces: [
        ...recording.traces,
        {
          events: [
            {
              ...recording.traces[0].events[0],
              name: 'paint',
              ray: 'other',
            },
          ],
          ray: 'other',
        },
      ],
    };
    function Dashboard() {
      const [view, setView] = useState<DashboardViewState>({
        frameQuery: 'app.render',
        page: 'frames',
      });
      return (
        <CoreRecordingDashboard
          navigation={{ onChange: setView, state: view }}
          onCompare={noop}
          onOpen={noop}
          onRefresh={noop}
          recording={withAnotherRoot}
        />
      );
    }
    render(<Dashboard />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Explore root calls to app.render',
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Drill into render #1' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Inspect frame 2: measure' }),
    ).toBeTruthy();
    const picker = screen.getByRole('combobox', { name: 'Filter functions' });
    fireEvent.change(picker, { target: { value: 'measure' } });
    expect(screen.getByText('No matching functions')).toBeTruthy();
    fireEvent.change(picker, { target: { value: 'paint' } });
    fireEvent.click(
      screen.getByRole('option', { name: 'app paint 1 records' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Drill into paint #1' }),
    ).toBeTruthy();
    expect(screen.queryByText('Call stack')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Inspect frame 2: measure' }),
    ).toBeNull();
    const breadcrumbs = screen.getByRole('navigation', {
      name: 'Trace drilldown',
    });
    expect(
      within(breadcrumbs).getByRole('button', { name: 'paint' }),
    ).toBeTruthy();
    expect(
      within(breadcrumbs).queryByRole('button', { name: /render/ }),
    ).toBeNull();
  });
  it('opens frame inspection in a drawer and closes it with its close control', async () => {
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trace frames' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Explore root calls to app.render',
      }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect frame 1: render' }),
    );
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Inspect frame 1: render' }),
    ).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Loading frames' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
