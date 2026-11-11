import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CoreRecordingDashboard,
  FrameInspector,
  type TraceRecording,
  useDashboard,
  validateCustomization,
} from '../src';

const recording: TraceRecording = {
  duration: 10,
  releasedAt: '',
  schemaVersion: 1,
  sessionId: 'test',
  startedAt: '',
  traces: [],
};
const noop = () => undefined;
afterEach(cleanup);
function SelectionBlock() {
  const { selectedTimeBucket, selectTimeBucket } = useDashboard();
  return (
    <button onClick={() => selectTimeBucket(7)}>
      Slice {selectedTimeBucket}
    </button>
  );
}
function ExtraPage() {
  const { recording: data } = useDashboard();
  return <p>Custom session {data.sessionId}</p>;
}
describe('dashboard composition', () => {
  it('shows only browser-relevant pages and copy for browser mode', () => {
    const onChange = vi.fn();
    render(
      <CoreRecordingDashboard
        extensions={{
          additionalPages: [
            {
              component: ExtraPage,
              id: 'caches',
              label: 'Caches',
              subtitle: 'Cache outcomes',
            },
          ],
        }}
        navigation={{ onChange, state: { page: 'frames' } }}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={{ ...recording, mode: 'browser' }}
      />,
    );
    const sections = within(
      screen.getByRole('navigation', { name: 'Dashboard sections' }),
    );
    expect(sections.queryByText('Functions')).toBeNull();
    expect(sections.queryByText('Trace frames')).toBeNull();
    expect(sections.getByText('Caches')).toBeTruthy();
    expect(
      screen.getByText(
        'Function recording is off. Calls and trace frames were not captured.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Function calls')).toBeNull();
    expect(screen.queryByText('Recording timeline')).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ page: 'overview' }, true);
  });

  it('keeps consumer-owned cache pages available in browser recordings', () => {
    const onChange = vi.fn();
    render(
      <CoreRecordingDashboard
        extensions={{ additionalPages: [{
          component: ExtraPage, id: 'caches', label: 'Caches', subtitle: 'Consumer data',
        }] }}
        navigation={{ onChange, state: { page: 'caches' } }}
        onCompare={noop} onOpen={noop} onRefresh={noop}
        recording={{ ...recording, mode: 'browser' }}
      />,
    );
    expect(screen.getByText('Custom session test')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders independent consumer channels without replacing the basic UI', () => {
    function CacheHits() {
      const { recording } = useDashboard();
      const sample = recording.extensionSamples?.find(s => s.channel === 'shop.cache');
      return <p>Cache hits: {(sample?.data as { hits: number }).hits}</p>;
    }
    function QueueDepth() {
      const { recording } = useDashboard();
      const sample = recording.extensionSamples?.find(s => s.channel === 'worker.queue');
      return <p>Queue depth: {(sample?.data as { depth: number }).depth}</p>;
    }
    render(
      <CoreRecordingDashboard
        extensions={{ overviewBlocks: [
          { id: 'shop.cache', component: CacheHits },
          { id: 'worker.queue', component: QueueDepth },
        ] }}
        onCompare={noop} onOpen={noop} onRefresh={noop}
        recording={{ ...recording, extensionSamples: [
          { at: 0, channel: 'shop.cache', data: { hits: 7 } },
          { at: 1, channel: 'worker.queue', data: { depth: 3 } },
        ] }}
      />,
    );
    expect(screen.getByText('Cache hits: 7')).toBeTruthy();
    expect(screen.getByText('Queue depth: 3')).toBeTruthy();
    expect(screen.getByText('Recording timeline')).toBeTruthy();
  });

  it('renders ray metadata in the inspector and rejects conflicting registrations', () => {
    render(
      <FrameInspector
        event={{ at: 1, id: 1, kind: 'call', name: 'resize', ray: 'r' }}
        rayMetadata={{ 'app.context': { componentId: 'comp-1' } }}
      />,
    );
    expect(screen.getByText('Ray metadata')).toBeTruthy();
    expect(screen.getByText(/comp-1/)).toBeTruthy();
    expect(() =>
      validateCustomization({}, [{ id: 'duplicate' }, { id: 'duplicate' }]),
    ).toThrow('function column');
    expect(() =>
      validateCustomization({
        additionalPages: [
          {
            component: ExtraPage,
            id: 'overview',
            label: 'Override',
            subtitle: '',
          },
        ],
      }),
    ).toThrow('dashboard page');
  });

  it('shares selection, replaces blocks and supports custom navigation', () => {
    render(
      <CoreRecordingDashboard
        extensions={{
          additionalPages: [
            {
              component: ExtraPage,
              id: 'custom',
              label: 'Custom',
              subtitle: 'Extra details',
            },
          ],
          blocks: {
            'overview.browser-signals': false,
            'overview.metrics': () => <p>Replacement metrics</p>,
          },
          overviewBlocks: [{ component: SelectionBlock, id: 'selection' }],
        }}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    expect(screen.getByText('Replacement metrics')).toBeTruthy();
    expect(screen.queryByText('Runtime on the same clock')).toBeNull();
    fireEvent.click(screen.getByText('Slice 0'));
    expect(screen.getByText('Slice 7')).toBeTruthy();
    fireEvent.click(screen.getByText('Custom'));
    expect(screen.getByText('Custom session test')).toBeTruthy();
  });
  it('allows page replacement to wrap the default content', () => {
    render(
      <CoreRecordingDashboard
        extensions={{
          pages: {
            overview: ({ children }) => (
              <>
                <p>Page wrapper</p>
                {children}
              </>
            ),
            problems: false,
          },
        }}
        onCompare={noop}
        onOpen={noop}
        onRefresh={noop}
        recording={recording}
      />,
    );
    expect(screen.getByText('Page wrapper')).toBeTruthy();
    expect(screen.getByText('Recording timeline')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Problems' })).toBeNull();
  });
});
