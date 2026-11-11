import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  analyzeCoreRecording,
  CoreRecordingDashboard,
  parseRecording,
  type TraceRecording,
  withRayMetadata,
} from '../src';

afterEach(cleanup);

// What an editor captures when the Platform services are loaded: the cache
// collector contributes on its own channel, and its decorator adds a field the
// core knows nothing about. A dashboard without the Platform UI has to carry
// that through untouched rather than choke on it.
const recordingWithPlatformData = {
  cacheSnapshots: [{ at: 1, namespaces: { ManifestAPICache: 2048 } }],
  duration: 10,
  extensionSamples: [
    { at: 1, channel: 'platform.cache', data: { hits: 3, misses: 1 } },
    { at: 2, channel: 'some-other-repo.widgets', data: { rendered: 7 } },
  ],
  releasedAt: '',
  schemaVersion: 1,
  sessionId: 'editor-session',
  startedAt: '',
  traces: [
    {
      events: [
        {
          at: 0,
          duration: 4,
          id: 1,
          kind: 'call' as const,
          name: 'Editor.doWork',
          namespace: 'editor',
          self: 4,
        },
      ],
      ray: 'ray-1',
    },
  ],
};

describe('a recording carrying another application data', () => {
  it('parses without interpreting foreign channels', () => {
    const parsed = parseRecording(JSON.stringify(recordingWithPlatformData));

    expect(parsed.extensionSamples?.map(({ channel }) => channel)).toEqual([
      'platform.cache',
      'some-other-repo.widgets',
    ]);
    expect(() => withRayMetadata(parsed)).not.toThrow();
  });

  it('analyses the trace data and ignores the rest', () => {
    const analysis = analyzeCoreRecording(
      recordingWithPlatformData as unknown as TraceRecording,
    );

    expect(analysis.functions.map(({ name }) => name)).toContain(
      'Editor.doWork',
    );
  });

  it('renders in a dashboard that has no UI for those channels', () => {
    expect(() =>
      render(
        <CoreRecordingDashboard
          recording={recordingWithPlatformData as unknown as TraceRecording}
        />,
      ),
    ).not.toThrow();

    // The dashboard comes up, and nothing surfaces the foreign data.
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
    expect(screen.queryByText(/platform\.cache/)).toBeNull();
    expect(screen.queryByText(/ManifestAPICache/)).toBeNull();
  });
});
