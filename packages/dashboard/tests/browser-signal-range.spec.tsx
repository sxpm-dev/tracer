import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardNavigation } from '../src/navigation';
import type { SessionSummary } from '../src/sessionData';
import type { TraceRecording } from '../src/types';

import { analyzeCoreRecording } from '../src/coreAnalysis';
import { CoreRecordingDashboard } from '../src/CoreRecordingDashboard';
import { createLocalSessionClient } from '../src/localSessionClient';

const recording: TraceRecording = {
  duration: 100,
  releasedAt: '',
  schemaVersion: 1,
  sessionId: 'range-test',
  startedAt: '',
  traces: [
    {
      events: [
        {
          at: 1,
          duration: 10,
          id: 1,
          kind: 'call',
          name: 'early',
          namespace: 'test',
          ray: 'root',
        },
        {
          at: 50,
          duration: 20,
          id: 2,
          kind: 'call',
          name: 'late',
          namespace: 'test',
          ray: 'root',
        },
      ],
      ray: 'root',
    },
  ],
};
const noop = () => undefined;
const navigation = (from?: number, to?: number): DashboardNavigation => ({
  onChange: noop,
  state: { from, page: 'overview', to },
});
const inspector = (container: HTMLElement) => {
  const element = container.querySelector('.cd-overview-function-preview');
  if (!element) {
    throw new Error('Browser function inspector is missing');
  }
  return within(element as HTMLElement);
};

afterEach(cleanup);

describe('browser signal function range', () => {
  it('shows the whole recording until a chart range is selected', async () => {
    const { container, rerender } = render(
      <CoreRecordingDashboard
        navigation={navigation()}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    expect(
      container.querySelector(
        '.cd-timeline-card .cd-overview-function-preview',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        '.cd-browser-signals .cd-overview-function-preview',
      ),
    ).toBeNull();
    await waitFor(() =>
      expect(
        inspector(container).getByRole('button', {
          name: 'Inspect test.early',
        }),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        inspector(container).getByRole('button', { name: 'Inspect test.late' }),
      ).toBeTruthy(),
    );
    expect(
      inspector(container).getByText('Functions across recording'),
    ).toBeTruthy();

    rerender(
      <CoreRecordingDashboard
        navigation={navigation(40, 90)}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    expect(
      inspector(container).getByText('Functions in selected range'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        inspector(container).getByRole('button', { name: 'Inspect test.late' }),
      ).toBeTruthy(),
    );
    expect(
      inspector(container).queryByRole('button', {
        name: 'Inspect test.early',
      }),
    ).toBeNull();
  });

  it('keeps old and estimated rows hidden while a new range loads', async () => {
    const local = createLocalSessionClient(recording);
    let releaseRange: (() => void) | undefined;
    const sessionClient = {
      ...local,
      analytics: async (...args: Parameters<typeof local.analytics>) => {
        if (args[1].from === 40) {
          await new Promise<void>((resolve) => {
            releaseRange = resolve;
          });
        }
        return local.analytics(...args);
      },
    };
    const { container, rerender } = render(
      <CoreRecordingDashboard
        navigation={navigation()}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
        sessionClient={sessionClient}
      />,
    );
    await waitFor(() =>
      expect(
        inspector(container).getByRole('button', {
          name: 'Inspect test.early',
        }),
      ).toBeTruthy(),
    );

    rerender(
      <CoreRecordingDashboard
        navigation={navigation(40, 90)}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
        sessionClient={sessionClient}
      />,
    );
    expect(
      inspector(container).getByRole('status', { name: 'Loading functions' }),
    ).toBeTruthy();
    expect(
      inspector(container).queryByRole('button', { name: /Inspect test/ }),
    ).toBeNull();
    await act(async () => releaseRange?.());
    await waitFor(() =>
      expect(
        inspector(container).getByRole('button', { name: 'Inspect test.late' }),
      ).toBeTruthy(),
    );
  });

  it('queries all saved session calls when no range is selected', async () => {
    const metadata = { ...recording, traces: [] };
    const summary: SessionSummary = {
      analysis: analyzeCoreRecording(recording),
      browser: {
        functions: [[['test.early', { calls: 1, duration: 10 }]]],
        series: [],
      },
      recording: metadata,
    };
    const { container } = render(
      <CoreRecordingDashboard
        navigation={navigation()}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={metadata}
        sessionClient={createLocalSessionClient(recording)}
        summary={summary}
      />,
    );

    await waitFor(() => {
      expect(
        inspector(container).getByRole('button', { name: 'Inspect test.late' }),
      ).toBeTruthy();
    });
    expect(
      inspector(container).getByRole('button', { name: 'Inspect test.early' }),
    ).toBeTruthy();
  });

  it('queries saved session calls for the selected range', async () => {
    const metadata = { ...recording, traces: [] };
    const summary: SessionSummary = {
      analysis: analyzeCoreRecording(recording),
      browser: {
        functions: [[['test.early', { calls: 1, duration: 10 }]]],
        series: [],
      },
      recording: metadata,
    };
    const { container } = render(
      <CoreRecordingDashboard
        navigation={navigation(40, 90)}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={metadata}
        sessionClient={createLocalSessionClient(recording)}
        summary={summary}
      />,
    );

    await waitFor(() => {
      expect(
        inspector(container).getByRole('button', { name: 'Inspect test.late' }),
      ).toBeTruthy();
    });
    expect(
      inspector(container).queryByRole('button', {
        name: 'Inspect test.early',
      }),
    ).toBeNull();
    expect(
      container.querySelector('.cd-timeline-selection')?.textContent,
    ).toContain('40.0 ms–90.0 ms');
  });

  it('keeps range controls with the chart and separate from functions', async () => {
    const onChange = vi.fn();
    const { container } = render(
      <CoreRecordingDashboard
        navigation={{ onChange, state: { from: 40, page: 'overview', to: 90 } }}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    const functions = inspector(container);
    const selection = container.querySelector('.cd-timeline-selection');
    if (!selection) {
      throw new Error('Timeline selection controls are missing');
    }
    expect(
      within(selection as HTMLElement).getByText('40.0 ms–90.0 ms'),
    ).toBeTruthy();
    expect(functions.queryByText('40.0 ms–90.0 ms')).toBeNull();
    expect(
      container.querySelector('.cd-browser-signals .cd-browser-range'),
    ).toBeNull();
    expect(
      functions.getByRole('columnheader', { name: 'Namespace' }),
    ).toBeTruthy();
    expect(functions.getByRole('columnheader', { name: 'Total' })).toBeTruthy();
    expect(functions.queryByRole('button', { name: 'Total' })).toBeNull();
    fireEvent.click(
      functions.getByRole('button', { name: /View all functions/ }),
    );
    expect(onChange).toHaveBeenCalledWith({
      from: 40,
      page: 'functions',
      to: 90,
    });
    fireEvent.click(
      await functions.findByRole('button', { name: 'Inspect test.late' }),
    );
    expect(onChange).toHaveBeenCalledWith({
      from: 40,
      functionId: 'test\u0000late',
      page: 'functions',
      to: 90,
    });
    fireEvent.click(
      within(selection as HTMLElement).getByRole('button', {
        name: 'Clear selection',
      }),
    );
    expect(onChange).toHaveBeenCalledWith({
      from: undefined,
      page: 'overview',
      to: undefined,
    });
  });
});
