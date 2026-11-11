import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TraceRecording } from '../src/types';

import { DashboardApp } from '../src/DashboardApp';
import { createLocalSessionClient } from '../src/localSessionClient';
import { createSampleRecording } from '../src/sampleRecording';
import {
  createSnapshotClient,
  createStandaloneSnapshot,
} from '../src/standaloneSnapshot';

const recording: TraceRecording = {
  duration: 3000,
  extensionSamples: [
    {
      at: 0,
      channel: 'tracing.ray-metadata',
      data: { secret: 'private-extension' },
    },
  ],
  releasedAt: '',
  schemaVersion: 1,
  sessionId: 'export-test',
  startedAt: '',
  traces: [
    {
      events: [
        {
          at: 10,
          duration: 2000,
          id: 1,
          kind: 'call',
          name: 'parent',
          namespace: 'service',
          ray: 'secret-ray',
        },
        {
          arguments: ['private-argument'],
          at: 20,
          duration: 20,
          id: 2,
          kind: 'call',
          name: 'child',
          namespace: 'service',
          parent: 1,
          ray: 'secret-ray',
        },
        {
          at: 1200,
          duration: 30,
          id: 3,
          kind: 'call',
          name: 'child',
          namespace: 'service',
          parent: 1,
          ray: 'secret-ray',
        },
      ],
      metadata: { secret: 'private-metadata' },
      ray: 'secret-ray',
    },
  ],
};
afterEach(() => {
  cleanup();
  document.getElementById('trace-data')?.remove();
  document.getElementById('dashboard-snapshot')?.remove();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('compact standalone dashboard', () => {
  it('retains all aggregates, charts and deduplicated paths without frames or ray metadata', async () => {
    const snapshot = await createStandaloneSnapshot(recording);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('private-');
    expect(serialized).not.toContain('secret-ray');
    expect(snapshot.summary.recording.traces).toEqual([]);
    expect(snapshot.summary.analysis.calls).toBe(3);
    const client = createSnapshotClient(snapshot);
    const query = { name: 'child', namespace: 'service' };
    expect(await client.analytics('export-test', query)).toMatchObject({
      counts: [1, 1, 0],
      functions: [{ calls: 2, totalDuration: 50 }],
      total: 2,
    });
    expect(await client.callPaths('export-test', query)).toEqual([
      {
        calls: 2,
        frames: [
          { kind: 'call', name: 'parent', namespace: 'service' },
          { kind: 'call', name: 'child', namespace: 'service' },
        ],
      },
    ]);
    expect(
      (await client.analytics('export-test', { root: 'service.parent' })).total,
    ).toBe(3);
    await expect(client.analytics('export-test', { from: 1 })).rejects.toThrow(
      'requires individual calls',
    );
  });

  it('exports saved summaries using only read-only projections, never fetching frames', async () => {
    const local = createLocalSessionClient(recording);
    const client = {
      ...local,
      analytics: vi.fn(),
      callPaths: vi.fn(),
      exportSnapshot: vi
        .fn()
        .mockResolvedValue(await createStandaloneSnapshot(recording)),
      frames: vi.fn(),
      rays: vi.fn(),
    };
    const summary = await client.summary('export-test');
    summary.recording = { ...recording, extensionSamples: [], traces: [] };
    const snapshot = await createStandaloneSnapshot(summary.recording, {
      client,
      summary,
    });
    expect(snapshot.scopes[0].functions).toHaveLength(2);
    expect(client.exportSnapshot).toHaveBeenCalledTimes(1);
    expect(client.analytics).not.toHaveBeenCalled();
    expect(client.callPaths).not.toHaveBeenCalled();
    expect(client.frames).not.toHaveBeenCalled();
    expect(client.rays).not.toHaveBeenCalled();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createStandaloneSnapshot(summary.recording, {
        client,
        signal: controller.signal,
        summary,
      }),
    ).rejects.toThrow();
  });

  it('opens function details and call paths offline with the real dashboard', async () => {
    const snapshot = await createStandaloneSnapshot(recording);
    for (const [id, data] of [
      ['trace-data', snapshot.summary.recording],
      ['dashboard-snapshot', snapshot],
    ] as const) {
      const script = document.createElement('script');
      script.id = id;
      script.type = 'application/json';
      script.textContent = JSON.stringify(data);
      document.body.append(script);
    }
    const fetch = vi.fn().mockRejectedValue(new Error('Offline'));
    vi.stubGlobal('fetch', fetch);
    render(<DashboardApp />);
    fireEvent.click(screen.getByRole('link', { name: /Functions/ }));
    const inspect = await screen.findByRole('button', {
      name: 'Inspect service.child',
    });
    fireEvent.click(inspect);
    await waitFor(() => expect(screen.getByText('Call paths')).toBeTruthy());
    await waitFor(() =>
      expect(screen.queryByText('Loading call paths…')).toBeNull(),
    );
    expect(document.querySelector('.cd-call-paths')?.textContent).toContain(
      'parent',
    );
    expect(
      screen.queryByRole('button', { name: 'Explore calls to child' }),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['light', 'browser'] as const)(
    'retains %s recording analysis',
    async (mode) => {
      const source = { ...createSampleRecording('light'), mode };
      const snapshot = await createStandaloneSnapshot(source);
      expect(snapshot.summary.recording.mode).toBe(mode);
      expect(snapshot.summary.analysis).toEqual({
        ...(await createLocalSessionClient(source).summary(source.sessionId))
          .analysis,
        rays: [],
      });
    },
  );
});
