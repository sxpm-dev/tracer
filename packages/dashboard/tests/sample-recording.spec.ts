import { describe, expect, it } from 'vitest';

import { analyzeCoreRecording } from '../src/coreAnalysis';
import { seriesFor } from '../src/CoreBrowserSignals';
import { createLocalSessionClient } from '../src/localSessionClient';
import { dashboardRouteUrl, parseDashboardRoute } from '../src/navigation';
import { parseRecording } from '../src/recording';
import { createSampleRecording } from '../src/sampleRecording';

describe('built-in sample recordings', () => {
  it('provides every browser metric and inspectable call details deterministically', async () => {
    const recording = createSampleRecording();
    expect(createSampleRecording()).toEqual(recording);
    expect(parseRecording(JSON.stringify(recording)).sessionId).toBe(
      recording.sessionId,
    );
    expect(
      new Set(recording.browserSamples!.map((item) => item.metric)).size,
    ).toBe(12);
    expect(seriesFor(recording)).toHaveLength(14);
    expect(
      recording.cpuSamples![0].scripts![0].forcedStyleAndLayoutDuration,
    ).toBeGreaterThan(0);
    const client = createLocalSessionClient(recording);
    const frames = await client.frames(recording.sessionId, {
      name: 'loadDocument',
      namespace: 'data',
    });
    expect(frames.total).toBe(120);
    const call = recording.traces[0].events[1];
    expect(call.arguments).toHaveLength(2);
    expect(call.error).toMatchObject({ name: 'SampleNetworkError' });
    expect(recording.traces[0].events[2].parent).toBe(call.id);
    const markers = recording.traces[0].events.filter(
      (event) => event.kind === 'marker',
    );
    expect(
      markers.map(({ name, namespace, parent }) => [namespace, name, parent]),
    ).toEqual([
      ['workspace', 'document-ready', 1],
      ['storage', 'cache-written', 1],
      ['renderer', 'render-committed', 1],
    ]);
    const markerFrames = await client.frames(recording.sessionId, {
      kind: 'marker',
      ray: recording.traces[0].ray,
    });
    expect(markerFrames.items.map((event) => event.name)).toEqual(
      expect.arrayContaining([
        'document-ready',
        'cache-written',
        'render-committed',
      ]),
    );
    expect(recording.traces[0].metadata).toMatchObject({ synthetic: true });
    expect(
      recording.traces
        .flatMap((trace) => trace.events)
        .some((event) => (event.memory?.deltaBytes ?? 0) < 0),
    ).toBe(true);
    expect(recording.extensionSamples![0].channel).toBe('sample.environment');
  });

  it('provides equivalent lightweight aggregates without individual call payloads', () => {
    const full = analyzeCoreRecording(createSampleRecording());
    const light = createSampleRecording('light');
    expect(light.traces).toEqual([]);
    expect(light.functionWindows).toHaveLength(120);
    expect(light.aggregates![0].argumentExample).toBeDefined();
    const analysis = analyzeCoreRecording(light);
    expect(analysis.calls).toBe(full.calls);
    expect(analysis.errors).toBe(full.errors);
    expect(analysis.blockingTotal).toBe(full.blockingTotal);
    expect(light.browserSamples).toHaveLength(720);
  });

  it('round trips shareable sample URLs with filters and inspector state', () => {
    const url = '/sample/full/frames?frame=2&namespace=data';
    const route = parseDashboardRoute(url);
    expect(route.kind).toBe('sample');
    expect(parseDashboardRoute(dashboardRouteUrl(route))).toEqual(route);
    expect(parseDashboardRoute('/sample/light/overview').sessionId).toBe(
      'light',
    );
    expect(parseDashboardRoute('/sample/unknown')).toMatchObject({
      kind: 'missing',
    });
  });
});
