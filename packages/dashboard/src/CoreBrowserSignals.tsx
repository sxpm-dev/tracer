import { useMemo } from 'react';

import type { CoreFunctionStat } from './coreAnalysis';
import type { BrowserSummary, SliceFunctions } from './sessionData';
import type { TraceBrowserSample, TraceRecording } from './types';

import { AnalyticsChart } from './AnalyticsChart';
import { functionKey, TIMELINE_BUCKETS } from './coreAnalysis';
import { DashboardIcon } from './DashboardIcon';
import { useDashboard } from './extensions';
import { FunctionCostsTable } from './FunctionCostsTable';
import { oneSecondBuckets, secondIndex } from './lightWindowBuckets';
import { createLocalSessionClient } from './localSessionClient';
import { metricColor } from './metricColors';
import { MetricInfo } from './MetricInfo';
import { formatDuration } from './recording';
import { legacyRuntimeSeries } from './runtimeSeries';
import { useResource } from './useResource';
import { useTimelineRange } from './useTimelineRange';

interface Series {
  count: number;
  counts: number[];
  metric: string;
  points: number[];
  unit: TraceBrowserSample['unit'];
}

export const LABELS: Record<string, string> = {
  'cpu.pressure': 'CPU pressure',
  'event.duration': 'Interaction duration',
  'event.input-delay': 'Input delay',
  'event.processing': 'Event processing',
  'frame.fps': 'Animation frame rate',
  'layout.shift': 'Layout shift',
  'memory.js-heap-high-water': 'Sampled heap high-water',
  'memory.js-heap-used': 'JavaScript heap',
  'memory.ua-total': 'Browser memory estimate',
  'page.visibility': 'Page visible',
  'resource.duration': 'Resource duration',
  'resource.transfer-size': 'Resource transfer',
  'thread.blocking': 'Main-thread blocking',
  'timer.lag': 'Timer delay',
};

function bucket(at: number, duration: number): number {
  return Math.min(
    TIMELINE_BUCKETS - 1,
    Math.max(0, Math.floor((at / Math.max(1, duration)) * TIMELINE_BUCKETS)),
  );
}

export function seriesFor(recording: TraceRecording): Series[] {
  const groups = new Map<string, TraceBrowserSample[]>();
  for (const sample of recording.browserSamples ?? []) {
    const group = groups.get(sample.metric) ?? [];
    group.push(sample);
    groups.set(sample.metric, group);
  }
  const browser = [...groups].map(([metric, samples]) => {
    const points = oneSecondBuckets(recording.duration);
    const counts = oneSecondBuckets(recording.duration);
    const average = /memory|fps|visibility/.test(metric);
    for (const sample of samples) {
      const index = secondIndex(sample.at, points.length, recording.duration);
      points[index] = average
        ? points[index] + sample.value
        : Math.max(points[index], sample.value);
      counts[index] += 1;
    }
    if (average) {
      for (let index = 0; index < points.length; index += 1) {
        if (counts[index]) {
          points[index] /= counts[index];
        }
      }
    }
    return {
      count: samples.length,
      counts,
      metric,
      points,
      unit: samples[0]!.unit,
    };
  });
  return [...legacyRuntimeSeries(recording), ...browser];
}

export function formatValue(
  value: number,
  unit: TraceBrowserSample['unit'],
): string {
  if (unit === 'ms') {
    return formatDuration(value);
  }
  if (unit === 'bytes') {
    return `${(value / 1_048_576).toFixed(1)} MB`;
  }
  if (unit === 'level') {
    return (
      ['Nominal', 'Fair', 'Serious', 'Critical'][Math.round(value)] ??
      String(value)
    );
  }
  if (unit === 'state') {
    return value >= 0.5 ? 'Visible' : 'Hidden';
  }
  return `${Number(value.toFixed(2))} ${unit === 'score' ? '' : unit}`.trim();
}

function functionsInRange(
  recording: TraceRecording,
  start: number,
  end: number,
): SliceFunctions {
  const grouped = new Map<string, { calls: number; duration: number }>();
  const add = (key: string, calls: number, duration: number) => {
    const current = grouped.get(key) ?? { calls: 0, duration: 0 };
    current.calls += calls;
    current.duration += duration;
    grouped.set(key, current);
  };
  if (recording.mode === 'light') {
    collectWindowFunctions(recording, start, end, add);
  } else {
    collectTraceFunctions(recording, start, end, add);
  }
  return [...grouped]
    .sort((left, right) => right[1].duration - left[1].duration)
    .slice(0, 5);
}

function displayedFunctions(
  recording: TraceRecording,
  summary: BrowserSummary | undefined,
  start: number,
  end: number,
): SliceFunctions {
  if (summary) {
    return summaryFunctionsInRange(summary, start, end, recording.duration);
  }
  return functionsInRange(recording, start, end);
}

type AddFunction = (key: string, calls: number, duration: number) => void;

function collectWindowFunctions(
  recording: TraceRecording,
  start: number,
  end: number,
  add: AddFunction,
): void {
  for (const window of recording.functionWindows ?? []) {
    if (window.at < start || window.at >= end) {
      continue;
    }
    for (const item of window.functions) {
      add(`${item.namespace}.${item.name}`, item.calls, item.totalDuration);
    }
  }
}

function collectTraceFunctions(
  recording: TraceRecording,
  start: number,
  end: number,
  add: AddFunction,
): void {
  for (const trace of recording.traces) {
    for (const event of trace.events) {
      if (event.kind === 'call' && event.at >= start && event.at < end) {
        add(
          `${event.namespace || 'unknown'}.${event.name}`,
          1,
          event.duration ?? 0,
        );
      }
    }
  }
}

export function CoreBrowserSignals({
  onSelect,
  recording,
  selected,
  summary,
}: {
  onSelect: (index: number) => void;
  recording: TraceRecording;
  selected: number;
  summary?: BrowserSummary;
}) {
  const series = useMemo(
    () => summary?.series ?? seriesFor(recording),
    [recording, summary],
  );
  const capabilities = recording.browserCapabilities ?? [];
  const missingSignals = missingRuntimeSignals(series);
  return (
    <section className="cd-card cd-browser-signals">
      <div className="cd-browser-heading">
        <div>
          <span className="cd-browser-eyebrow">BROWSER SIGNALS</span>
          <h2>
            {recording.mode === 'browser'
              ? 'Browser signals over time'
              : 'Runtime on the same clock'}
          </h2>
          <p>
            {recording.mode === 'browser'
              ? 'Explore browser measurements across this recording. Function calls were not recorded.'
              : 'Select any time slice to line up browser state with traced calls.'}
          </p>
        </div>
      </div>
      {series.length ? (
        <div className="cd-browser-grid">
          {series.map((item) => (
            <SignalChart
              duration={recording.duration}
              item={item}
              key={item.metric}
              onSelect={onSelect}
              selected={selected}
            />
          ))}
        </div>
      ) : (
        <p className="cd-browser-empty">
          No browser samples in this recording. Check the capture availability
          below.
        </p>
      )}
      <div className="cd-browser-notes">
        {missingSignals && <p>{missingSignals}</p>}
        <p>
          Blocking is time spent blocking the main thread, not CPU utilization.
          CPU pressure is a captured browser pressure level. Heap high-water is
          the largest sampled heap in each slice. Empty slices have no samples.
        </p>
      </div>
      {!!capabilities.length && (
        <details className="cd-browser-capabilities">
          <summary>
            Capture availability ·{' '}
            {capabilities.filter((item) => item.status === 'active').length}{' '}
            active
          </summary>
          <div>
            {capabilities.map((item) => (
              <span key={item.name} title={item.reason}>
                <i data-status={item.status} />
                {item.name}: {item.status}
              </span>
            ))}
          </div>
        </details>
      )}
      {!!recording.droppedBrowserSamples && (
        <p className="cd-browser-warning">
          {recording.droppedBrowserSamples.toLocaleString()} browser samples
          were omitted at the configured limit.
        </p>
      )}
    </section>
  );
}

export function OverviewSliceFunctions({
  aggregateFunctions,
  recording,
  summary,
}: {
  aggregateFunctions: CoreFunctionStat[];
  recording: TraceRecording;
  summary?: BrowserSummary;
}) {
  const { range } = useTimelineRange();
  const { navigation, sessionClient } = useDashboard();
  const [start, end] = range ?? [0, recording.duration];
  const client = useMemo(
    () => sessionClient ?? createLocalSessionClient(recording),
    [recording, sessionClient],
  );
  const exact = useResource(
    `${recording.sessionId}:overview-functions:${range ? `${start}:${end}` : 'all'}`,
    (signal) =>
      client.analytics(
        recording.sessionId,
        range
          ? { from: start, functionLimit: 5, to: end }
          : { functionLimit: 5 },
        signal,
      ),
    recording.mode !== 'light',
  );
  const functions = useMemo(
    () => displayedFunctions(recording, summary, start, end),
    [end, recording, start, summary],
  );
  const loading = recording.mode !== 'light' && !exact.data && !exact.error;
  return (
    <BrowserFunctionInspector
      error={recording.mode === 'light' ? undefined : exact.error}
      functions={
        recording.mode === 'light'
          ? range
            ? functions.map(([name, stat]) => previewFunction(name, stat))
            : [...aggregateFunctions]
                .sort((left, right) => right.totalDuration - left.totalDuration)
                .slice(0, 5)
          : [...(exact.data?.functions ?? [])]
              .sort((left, right) => right.totalDuration - left.totalDuration)
              .slice(0, 5)
      }
      loading={loading}
      onInspect={(item) =>
        navigation?.onChange({
          ...navigation.state,
          functionId: functionKey(item.namespace, item.name),
          page: 'functions',
        })
      }
      onViewAll={() =>
        navigation?.onChange({ ...navigation.state, page: 'functions' })
      }
      rangeSelected={Boolean(range)}
    />
  );
}

function BrowserFunctionInspector({
  error,
  functions,
  loading,
  onInspect,
  onViewAll,
  rangeSelected,
}: {
  error?: string;
  functions: CoreFunctionStat[];
  loading: boolean;
  onInspect: (item: CoreFunctionStat) => void;
  onViewAll: () => void;
  rangeSelected: boolean;
}) {
  return (
    <div className="cd-overview-function-preview">
      <div className="cd-slice-heading">
        <div>
          <strong>
            {rangeSelected
              ? 'Functions in selected range'
              : 'Functions across recording'}
          </strong>
          <small>Inclusive time can overlap across nested calls.</small>
        </div>
        <button className="cd-button" onClick={onViewAll} type="button">
          View all functions
          <DashboardIcon name="arrow-up-right" />
        </button>
      </div>
      <div className="cd-slice-results">
        <FunctionCostsTable
          error={error}
          items={functions}
          loading={loading}
          onInspect={onInspect}
          renderAction={(item) => (
            <button
              aria-label={`Open full function view for ${item.namespace}.${item.name}`}
              className="cd-icon-button"
              onClick={() => onInspect(item)}
              title="Open full function view"
              type="button"
            >
              <DashboardIcon name="arrow-up-right" />
            </button>
          )}
        />
        {!loading && !error && !functions.length && (
          <p>No function calls in this time interval.</p>
        )}
      </div>
    </div>
  );
}

function previewFunction(
  fullName: string,
  stat: { calls: number; duration: number },
): CoreFunctionStat {
  const separator = fullName.indexOf('.');
  return {
    calls: stat.calls,
    errors: NaN,
    maxDuration: NaN,
    minDuration: NaN,
    name: fullName.slice(separator + 1),
    namespace: separator < 0 ? 'unknown' : fullName.slice(0, separator),
    totalDuration: stat.duration,
  };
}

function summaryFunctionsInRange(
  summary: BrowserSummary,
  start: number,
  end: number,
  duration: number,
): SliceFunctions {
  const grouped = new Map<string, { calls: number; duration: number }>();
  summary.functions.forEach((functions, index) => {
    const bucketStart = (index / TIMELINE_BUCKETS) * duration;
    const bucketEnd = ((index + 1) / TIMELINE_BUCKETS) * duration;
    if (bucketStart >= end || bucketEnd <= start) {
      return;
    }
    for (const [name, stat] of functions) {
      const current = grouped.get(name) ?? { calls: 0, duration: 0 };
      current.calls += stat.calls;
      current.duration += stat.duration;
      grouped.set(name, current);
    }
  });
  return [...grouped]
    .sort((left, right) => right[1].duration - left[1].duration)
    .slice(0, 5);
}

function SignalChart({
  duration,
  item,
  onSelect,
  selected,
}: {
  duration: number;
  item: Series;
  onSelect: (index: number) => void;
  selected: number;
}) {
  const { range, selectRange } = useTimelineRange();
  const selectedSecond = secondIndex(
    ((selected + 0.5) / TIMELINE_BUCKETS) * duration,
    item.points.length,
    duration,
  );
  const selectedValue = item.points[selectedSecond] ?? 0;
  return (
    <div className="cd-signal-card">
      <div className="cd-signal-title">
        <div>
          <div className="cd-metric-heading">
            <strong>{LABELS[item.metric] ?? item.metric}</strong>
            <MetricInfo
              metric={item.metric}
              title={LABELS[item.metric] ?? item.metric}
            />
          </div>
          <small>{item.count.toLocaleString()} samples</small>
        </div>
        <b style={{ color: metricColor(item.metric) }}>
          {item.counts[selectedSecond]
            ? formatValue(selectedValue, item.unit)
            : '—'}
        </b>
      </div>
      <AnalyticsChart
        bucketMs={1_000}
        compact
        duration={duration}
        onRange={selectRange}
        onSelect={(index) =>
          onSelect(
            bucket(
              index * 1_000 + Math.min(500, duration - index * 1_000),
              duration,
            ),
          )
        }
        range={range}
        selected={selectedSecond}
        series={[
          {
            color: metricColor(item.metric),
            counts: item.counts,
            format: (value) => formatValue(value, item.unit),
            label: LABELS[item.metric] ?? item.metric,
            values: item.points,
          },
        ]}
        variant="bar"
      />
    </div>
  );
}

function missingRuntimeSignals(series: Series[]): string {
  const missing = [];
  if (!series.some((item) => item.metric === 'cpu.pressure')) {
    missing.push('CPU pressure');
  }
  if (!series.some((item) => item.metric.startsWith('memory.'))) {
    missing.push('memory');
  }
  return missing.length
    ? `${missing.join(' and ')} were not captured in this recording.`
    : '';
}
