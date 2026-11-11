import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import type { TraceRecording } from '../src/types';

import { AnalyticsChart } from '../src/AnalyticsChart';
import { formatValue, seriesFor } from '../src/CoreBrowserSignals';

afterEach(cleanup);
it('buckets legacy heap peaks and blocking without inventing CPU pressure', () => {
  // Charts bucket by the second, so this recording spans five buckets with a
  // deliberate gap in the middle.
  const recording = {
    cpuSamples: [
      { at: 1, blockingDuration: 20 },
      { at: 2, blockingDuration: 30 },
    ],
    duration: 5_000,
    traces: [
      {
        events: [
          { at: 1, memory: { endBytes: 100 } },
          { at: 2, memory: { endBytes: 200 } },
          { at: 3_500, memory: { endBytes: 50 } },
        ],
      },
    ],
  } as TraceRecording;
  const series = seriesFor(recording);
  expect(series.map((item) => item.metric)).toEqual([
    'thread.blocking',
    'memory.js-heap-high-water',
  ]);
  // Blocking sums within a bucket; heap keeps the high-water mark.
  expect(series[0].points[0]).toBe(50);
  expect(series[1].points).toHaveLength(5);
  expect(series[1].points[0]).toBe(200);
  expect(series[1].points[3]).toBe(50);
  // An untouched second stays empty rather than being filled in.
  expect(series[1].counts[1]).toBe(0);
  expect(series[1].points[1]).toBe(0);
  expect(formatValue(2, 'level')).toBe('Serious');
});
it('renders bounded bars with accessible tooltips and gaps for missing samples', () => {
  const { container } = render(
    <AnalyticsChart
      duration={1000}
      onSelect={() => undefined}
      selected={0}
      series={[
        {
          color: 'blue',
          counts: [1, 0, 1],
          format: String,
          label: 'Heap',
          values: [20, 0, 10],
        },
      ]}
      variant="bar"
    />,
  );
  expect(container.querySelectorAll('svg rect')).toHaveLength(2);
  fireEvent.focus(screen.getByRole('button', { name: 'Select time slice 2' }));
  expect(screen.getByRole('tooltip').textContent).toContain('No samples');
});
