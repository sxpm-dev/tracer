import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { AnalyticsChart } from '../src/AnalyticsChart';
import { CoreRecordingDashboard } from '../src/CoreRecordingDashboard';
import { FunctionCostsTable } from '../src/FunctionCostsTable';
import { createSampleRecording } from '../src/sampleRecording';
import { SessionsHome } from '../src/SessionsHome';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const noop = () => undefined;
// These tests drive the full dashboard over the 120-trace sample recording.
// They take ~5s locally and 4-5x longer on CI, so 20s timed out there.
const HEAVY_UI_TEST_TIMEOUT = 60_000;
it('keeps actions after extension columns in the function table', () => {
  render(
    <FunctionCostsTable
      columns={[{ id: 'cache', render: () => 'Cache value' }]}
      extensionHeadings={<th>Cache</th>}
      items={[
        {
          calls: 1,
          errors: 0,
          maxDuration: 2,
          minDuration: 2,
          name: 'read',
          namespace: 'data',
          totalDuration: 2,
        },
      ]}
      onInspect={noop}
      renderAction={() => <button>Open</button>}
    />,
  );
  const headings = screen.getAllByRole('columnheader');
  expect(headings.at(-2)?.textContent).toBe('Cache');
  expect(headings.at(-1)?.getAttribute('aria-label')).toBe('Actions');
  const cells = screen.getAllByRole('cell');
  expect(cells.at(-2)?.textContent).toBe('Cache value');
  expect(cells.at(-1)?.querySelector('button')?.textContent).toBe('Open');
});
it('shows and copies the current recording ID in the sidebar', async () => {
  const onOpen = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText },
  });
  render(
    <CoreRecordingDashboard
      onCompare={noop}
      onOpen={onOpen}
      onRefresh={noop}
      recording={createSampleRecording()}
    />,
  );

  const card = screen
    .getByText('CURRENT RECORDING')
    .closest('.cd-session-card')!;
  const sessions = screen.getByRole('button', { name: 'Sessions' });
  expect(
    card.compareDocumentPosition(sessions) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(within(card).getByText('sample-full')).toBeTruthy();
  fireEvent.click(
    within(card).getByRole('button', { name: 'Copy recording ID' }),
  );
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('sample-full'));
  expect(
    within(card).getByRole('button', { name: 'Recording ID copied' }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to sessions' }));
  expect(onOpen).toHaveBeenCalledOnce();
});
it('selects an exact range by dragging in either direction and reports normalized calls/s', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const onRange = vi.fn();
  const { container } = render(
    <AnalyticsChart
      duration={1000}
      onRange={onRange}
      onSelect={noop}
      selected={0}
      series={[
        {
          color: 'red',
          format: String,
          label: 'Calls',
          rate: true,
          values: [10, 20],
        },
      ]}
    />,
  );
  const plot = container.querySelector('.cd-chart-plot')!;
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    width: 100,
  } as DOMRect);
  fireEvent.pointerDown(plot, { button: 0, clientX: 80 });
  fireEvent.pointerMove(plot, { clientX: 20 });
  fireEvent.pointerUp(plot, { clientX: 20 });
  expect(onRange).toHaveBeenCalledWith([200, 800]);
  fireEvent.focus(screen.getByRole('button', { name: 'Select time slice 2' }));
  expect(screen.getByRole('tooltip').textContent).toContain('20 · 40 calls/s');
});
it('offers row navigation, header sorting and a separate delete confirmation', async () => {
  const onOpen = vi.fn(),
    onRefresh = vi.fn();
  const fetcher = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('fetch', fetcher);
  const base = {
    bytes: 100,
    duration: 20,
    eventCount: 2,
    sessionId: 'one',
    startedAt: '2026-09-25',
    status: 'complete' as const,
    title: 'One',
    traceCount: 1,
    updatedAt: '',
  };
  render(
    <SessionsHome
      href={() => '/sessions/one/overview'}
      loading={false}
      onFile={noop}
      onOpen={onOpen}
      onRefresh={onRefresh}
      sessions={[base, { ...base, bytes: 200, sessionId: 'two', title: 'Two' }]}
    />,
  );
  fireEvent.click(
    screen
      .getByRole('link', { name: 'One one' })
      .closest('tr')!
      .querySelector('.cd-session-status')!,
  );
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ sessionId: 'one' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Size' }));
  expect(
    screen
      .getByRole('button', { name: 'Size' })
      .closest('th')!
      .getAttribute('aria-sort'),
  ).toBe('descending');
  const menuTrigger = screen.getByLabelText('Actions for One');
  const menu = menuTrigger.closest('details')!;
  fireEvent.click(menuTrigger);
  expect(menu.open).toBe(true);
  fireEvent.pointerDown(menuTrigger);
  expect(menu.open).toBe(true);
  fireEvent.pointerDown(document.body);
  expect(menu.open).toBe(false);
  fireEvent.click(menuTrigger);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(menu.open).toBe(false);
  fireEvent.click(menuTrigger);
  fireEvent.click(
    within(
      screen.getByLabelText('Actions for One').closest('details')!,
    ).getByRole('button', { name: 'Delete recording' }),
  );
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
it('confirms before deleting all saved recordings and leaves active recordings alone', async () => {
  const onRefresh = vi.fn();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }),
  );
  vi.stubGlobal('fetch', fetcher);
  const base = {
    bytes: 100,
    duration: 20,
    eventCount: 2,
    sessionId: 'one',
    startedAt: '2026-09-25',
    status: 'complete' as const,
    title: 'One',
    traceCount: 1,
    updatedAt: '',
  };
  render(
    <SessionsHome
      href={() => '/sessions/one/overview'}
      loading={false}
      onFile={noop}
      onOpen={noop}
      onRefresh={onRefresh}
      sessions={[
        base,
        { ...base, sessionId: 'two', title: 'Two' },
        { ...base, sessionId: 'active', status: 'recording', title: 'Active' },
      ]}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete saved recordings' }),
  );
  expect(
    screen.getByRole('alertdialog', { name: 'Delete 2 saved recordings?' }),
  ).toBeTruthy();
  expect(screen.getByText('1 active recording will remain.')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete saved recordings' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Delete all saved recordings' }),
  );
  await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/recordings/one',
    '/api/recordings/two',
  ]);
  expect(screen.queryByRole('alertdialog')).toBeNull();
});
it(
  'uses one function filter and checkbox filters',
  async () => {
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={createSampleRecording()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    await screen.findByRole('button', {
      name: 'Inspect workspace.openDocument',
    });
    const functionRow = screen
      .getByRole('button', { name: 'Inspect workspace.openDocument' })
      .closest('tr')!;
    expect(functionRow.cells[0].textContent).toBe('workspace');
    expect(functionRow.cells[1].textContent).toBe('openDocument');
    expect(
      screen
        .getByRole('button', { name: 'Inspect workspace.openDocument' })
        .querySelector('.cd-trace-kind.is-call svg'),
    ).toBeTruthy();
    expect(screen.getAllByLabelText('Filter functions')).toHaveLength(1);
    expect(
      screen.getByRole('checkbox', { name: 'Root calls only' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Failed calls only' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('spinbutton', { name: 'Minimum duration (ms)' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Root calls only' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Inspect data.loadDocument' }),
      ).toBeNull(),
    );
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'Minimum duration (ms)' }),
      { target: { value: '1000' } },
    );
  },
  HEAVY_UI_TEST_TIMEOUT,
);

it(
  'groups root calls and inspects a function from the frame table',
  async () => {
    // Same starting point as the filter test above: the Trace frames page is
    // reached from Functions, and this test owns everything after that.
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={createSampleRecording()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Functions' }));
    await screen.findByRole('button', {
      name: 'Inspect workspace.openDocument',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Trace frames' }));
    expect(
      screen.queryByRole('spinbutton', { name: 'Minimum duration (ms)' }),
    ).toBeNull();
    expect(
      screen.queryByRole('spinbutton', { name: 'Maximum duration (ms)' }),
    ).toBeNull();
    expect(
      screen.queryByRole('checkbox', { name: 'Root calls only' }),
    ).toBeNull();
    const rootLoader = screen.getByRole('status', {
      name: 'Loading root functions',
    });
    expect(rootLoader.closest('tbody')).toBeTruthy();
    expect(rootLoader.closest('td')?.getAttribute('colspan')).toBe('8');
    const group = await screen.findByRole('button', {
      name: 'Explore root calls to workspace.openDocument',
    });
    expect(group.closest('tr')!.cells[0].textContent).toBe('workspace');
    expect(group.closest('tr')!.cells[1].textContent).toBe('openDocument');
    expect(group.closest('tr')!.textContent).toContain('120');
    expect(group.closest('tr')!.textContent).toContain('280.0 ms');
    expect(group.closest('tr')!.textContent).toContain('200.0 ms');
    fireEvent.click(screen.getByRole('button', { exact: true, name: 'Avg' }));
    expect(
      screen
        .getByRole('button', { exact: true, name: 'Avg' })
        .closest('th')!
        .getAttribute('aria-sort'),
    ).toBe('descending');
    fireEvent.click(group.closest('tr')!);
    expect(
      screen.queryByRole('checkbox', { name: 'Root calls only' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Namespace: All namespaces' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
    const frameLoader = screen.getByRole('status', { name: 'Loading frames' });
    expect(frameLoader.closest('tbody')).toBeTruthy();
    expect(frameLoader.closest('td')?.getAttribute('colspan')).toBe('6');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Inspect function workspace.openDocument',
      }),
    );
    const functionDrawer = await screen.findByRole('dialog', {
      name: 'openDocument',
    });
    // The value appears in more than one cell of the drawer, so assert it is
    // present rather than requiring a single match.
    expect(
      (await within(functionDrawer).findAllByText('120')).length,
    ).toBeGreaterThan(0);
    fireEvent.click(
      within(functionDrawer).getByRole('button', { name: 'Close inspector' }),
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  },
  HEAVY_UI_TEST_TIMEOUT,
);

it(
  'expands a call tree and hides descendants on row click',
  async () => {
    // Reaches the frame table the same way the test above does, then owns
    // the call-tree behaviour from there.
    render(
      <CoreRecordingDashboard
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={createSampleRecording()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trace frames' }));
    fireEvent.click(
      (
        await screen.findByRole('button', {
          name: 'Explore root calls to workspace.openDocument',
        })
      ).closest('tr')!,
    );
    fireEvent.click(
      (
        await screen.findAllByRole('button', {
          name: 'Drill into openDocument #1',
        })
      )[0].closest('tr')!,
    );
    expect(
      screen.queryByRole('checkbox', { name: 'Root calls only' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Duration' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Start' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Duration' })).toBeTruthy();
    expect(
      (
        await screen.findByRole('button', {
          name: 'Inspect frame 1: openDocument',
        })
      )
        .closest('tbody')!
        .querySelector('tr:first-child')?.textContent,
    ).toContain('openDocument');
    expect(
      screen
        .getByRole('button', { name: 'Inspect frame 1: openDocument' })
        .closest('tr')!
        .querySelector('.cd-tree-stem'),
    ).toBeTruthy();
    const nested = await screen.findByRole('button', {
      name: 'Inspect frame 3: readIndex',
    });
    expect(
      nested.closest('tr')!.querySelectorAll('.cd-tree-guide'),
    ).toHaveLength(2);
    const marker = await screen.findByRole('button', {
      name: 'Inspect frame 6: document-ready',
    });
    expect(
      marker.closest('tr')!.querySelector('.cd-trace-kind.is-marker svg'),
    ).toBeTruthy();
    expect(marker.closest('tr')!.cells[0].textContent).toBe('workspace');
    expect(marker.closest('tr')!.cells[1].textContent).toContain(
      'document-ready',
    );
    expect(
      marker.closest('tr')!.cells[2].querySelector('.cd-event-status.is-ok')
        ?.textContent,
    ).toBe('ok');
    const toggle = screen.getByRole('button', {
      name: 'Collapse children of loadDocument #2',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle.closest('tr')!);
    expect(
      screen.queryByRole('button', { name: 'Inspect frame 3: readIndex' }),
    ).toBeNull();
    expect(toggle.closest('tr')!.className).toContain('cd-tree-collapsed');
    fireEvent.click(toggle.closest('tr')!);
    const leaf = await screen.findByRole('button', {
      name: 'Inspect frame 3: readIndex',
    });
    expect(
      leaf.closest('tr')!.querySelector('.cd-trace-kind.is-call svg'),
    ).toBeTruthy();
    fireEvent.click(leaf.closest('tr')!);
    fireEvent.keyDown(leaf.closest('tr')!, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(leaf.closest('tr')!.hasAttribute('tabindex')).toBe(false);
    fireEvent.click(leaf);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Namespace: All namespaces' }),
    );
    fireEvent.click(screen.getByRole('option', { name: 'data' }));
    const filteredParent = await screen.findByRole('button', {
      name: 'Inspect frame 2: loadDocument',
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Inspect frame 3: readIndex' }),
      ).toBeNull(),
    );
    expect(
      filteredParent.closest('tr')!.querySelector('.cd-tree-toggle'),
    ).toBeNull();
    expect(
      filteredParent.closest('tr')!.querySelector('.cd-tree-stem'),
    ).toBeNull();
  },
  HEAVY_UI_TEST_TIMEOUT,
);
