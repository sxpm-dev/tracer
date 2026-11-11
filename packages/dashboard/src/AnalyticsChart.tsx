import { useId, useState } from 'react';

import { formatDuration } from './recording';
import { useChartBrush } from './useChartBrush';

export interface ChartSeries {
  color: string;
  counts?: number[];
  format: (value: number) => string;
  label: string;
  rate?: boolean;
  tooltipOnly?: boolean;
  unavailable?: string;
  values: number[];
}
function peakLabel(item: ChartSeries, loading: boolean): string {
  if (item.unavailable) {
    return 'Unavailable';
  }
  return loading
    ? 'Loading…'
    : `${item.format(Math.max(0, ...item.values))} peak`;
}
function ChartLoadingOverlay({ loading }: { loading: boolean }) {
  if (!loading) {
    return null;
  }
  return (
    <div
      aria-label="Loading call timings"
      className="cd-chart-plot-loader"
      role="status"
    >
      <span aria-hidden="true" className="cd-spinner" />
    </div>
  );
}
export function AnalyticsChart({
  bucketMs,
  compact = false,
  duration,
  loading = false,
  markers = [],
  onRange,
  onSelect,
  range: committedRange,
  selected,
  series,
  variant = 'line',
}: {
  bucketMs?: number;
  compact?: boolean;
  duration: number;
  loading?: boolean;
  markers?: { at: number; count: number }[];
  onRange?: (range: [number, number]) => void;
  onSelect: (index: number) => void;
  range?: [number, number];
  selected?: number;
  series: ChartSeries[];
  variant?: 'bar' | 'line';
}) {
  const brush = useChartBrush(duration, onRange);
  const range = selectedRange(brush.preview, committedRange);
  const id = useId().replace(/:/g, '');
  const [hovered, setHovered] = useState<number>();
  const [hidden, setHidden] = useState<string[]>([]);
  const visible = series.filter((item) => !hidden.includes(item.label));
  const plotted = plottedSeries(visible, loading);
  const count = series[0]?.values.length ?? 48;
  const columns = bucketMs
    ? Array.from({ length: count }, (_, index) =>
        Math.max(
          0.001,
          sliceBounds(index, count, duration, bucketMs)[1] - index * bucketMs,
        ),
      )
        .map((width) => `${width}fr`)
        .join(' ')
    : `repeat(${count}, 1fr)`;
  const active = activeIndex(hovered, selected);
  return (
    <div className={`cd-analytic-chart ${compact ? 'is-compact' : ''}`}>
      <div className="cd-chart-legends">
        {series
          .filter((item) => !item.tooltipOnly)
          .map((item) => (
            <button
              aria-pressed={!hidden.includes(item.label)}
              key={item.label}
              onClick={() =>
                setHidden(
                  hidden.includes(item.label)
                    ? hidden.filter((label) => label !== item.label)
                    : [...hidden, item.label],
                )
              }
            >
              <i style={{ background: item.color }} />
              {item.label}
              <span>{peakLabel(item, loading)}</span>
            </button>
          ))}
      </div>
      <div
        {...brush.handlers}
        aria-busy={loading}
        className="cd-chart-plot"
        onMouseLeave={() => setHovered(undefined)}
      >
        <svg
          aria-hidden="true"
          preserveAspectRatio="none"
          viewBox="0 0 1000 180"
        >
          <defs>
            {plotted.map((item, index) => (
              <linearGradient
                id={`${id}-${index}`}
                key={item.label}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor={item.color} stopOpacity=".28" />
                <stop offset="100%" stopColor={item.color} stopOpacity=".015" />
              </linearGradient>
            ))}
          </defs>
          {[0, 1, 2, 3].map((line) => (
            <line
              key={line}
              opacity=".15"
              stroke="currentColor"
              strokeDasharray="3 5"
              x1="0"
              x2="1000"
              y1={line * 55 + 8}
              y2={line * 55 + 8}
            />
          ))}
          {plotted.map((item, index) =>
            variant === 'bar' ? (
              <ChartBars
                bucketMs={bucketMs}
                duration={duration}
                index={index}
                key={item.label}
                series={item}
                total={plotted.length}
              />
            ) : (
              <ChartPath
                bucketMs={bucketMs}
                duration={duration}
                gradient={`${id}-${index}`}
                key={item.label}
                series={item}
              />
            ),
          )}
          {range && <SelectionOverlay duration={duration} range={range} />}
          {markers.map((mark, index) => (
            <line
              key={index}
              opacity={
                markers.length === 1
                  ? 1
                  : Math.min(0.9, 0.65 + Math.log10(mark.count + 1) / 16)
              }
              stroke="var(--cd-call-marker, #be185d)"
              strokeWidth={markers.length === 1 ? 3 : 2}
              vectorEffect="non-scaling-stroke"
              x1={(mark.at / Math.max(1, duration)) * 1000}
              x2={(mark.at / Math.max(1, duration)) * 1000}
              y1="0"
              y2="180"
            >
              <title>
                {mark.count.toLocaleString()} calls at {formatDuration(mark.at)}
              </title>
            </line>
          ))}
          <BucketGuide
            bucketMs={bucketMs}
            count={count}
            duration={duration}
            index={guideIndex(hovered, selected)}
          />
        </svg>
        <div
          className="cd-chart-hit-grid"
          style={{ gridTemplateColumns: columns }}
        >
          {Array.from({ length: count }, (_, index) => (
            <button
              aria-label={`Select time slice ${index + 1}`}
              aria-pressed={selected === index}
              disabled={loading}
              key={index}
              onBlur={() => setHovered(undefined)}
              onClick={() => onSelect(index)}
              onFocus={() => setHovered(index)}
              onMouseEnter={() => setHovered(index)}
            />
          ))}
        </div>
        <ChartTooltip
          active={active}
          bucketMs={bucketMs}
          count={count}
          duration={duration}
          hovered={hovered}
          loading={loading}
          series={visible}
        />
        <ChartLoadingOverlay loading={loading} />
      </div>
      <div className="cd-timeline-axis">
        <span>0</span>
        <span>{formatDuration(duration / 4)}</span>
        <span>{formatDuration(duration / 2)}</span>
        <span>{formatDuration(duration * 0.75)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}
function SelectionOverlay({
  duration,
  range,
}: {
  duration: number;
  range: [number, number];
}) {
  const start = (range[0] / Math.max(1, duration)) * 1000;
  const end = (range[1] / Math.max(1, duration)) * 1000;
  return (
    <g className="cd-chart-selection">
      <rect height="180" width={Math.max(0, end - start)} x={start} y="0" />
      {[start, end].map((x, index) => (
        <line key={index} x1={x} x2={x} y1="0" y2="180" />
      ))}
    </g>
  );
}
function plottedSeries(series: ChartSeries[], loading: boolean) {
  return loading
    ? []
    : series.filter((item) => !item.tooltipOnly && !item.unavailable);
}
function ChartTooltip({
  active,
  bucketMs,
  count,
  duration,
  hovered,
  loading,
  series,
}: {
  active: number;
  bucketMs?: number;
  count: number;
  duration: number;
  hovered?: number;
  loading: boolean;
  series: ChartSeries[];
}) {
  if (loading || hovered === undefined) {
    return null;
  }
  const [start, end] = sliceBounds(active, count, duration, bucketMs);
  return (
    <div
      className="cd-chart-tooltip"
      role="tooltip"
      style={{
        left: `${Math.max(15, Math.min(85, sliceCenter(active, count, duration, bucketMs) / 10))}%`,
      }}
    >
      <strong>
        {formatDuration(start)} — {formatDuration(end)}
        {bucketMs && end - start < bucketMs ? ' (partial second)' : ''}
      </strong>
      {series.map((item) => (
        <span key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
          <b>{tooltipValue(item, active, end - start)}</b>
        </span>
      ))}
    </div>
  );
}
function ChartPath({
  bucketMs,
  duration,
  gradient,
  series,
}: {
  bucketMs?: number;
  duration: number;
  gradient: string;
  series: ChartSeries;
}) {
  const max = Math.max(1, ...series.values);
  const segments: string[][] = [];
  let segment: string[] = [];
  series.values.forEach((value, index) => {
    if (series.counts && !series.counts[index]) {
      segment = [];
      return;
    }
    if (!segment.length) {
      segments.push(segment);
    }
    segment.push(
      `${sliceCenter(index, series.values.length, duration, bucketMs)},${172 - (value / max) * 156}`,
    );
  });
  return (
    <>
      {segments.map((points, index) => {
        const first = points[0].split(',')[0];
        const last = points[points.length - 1].split(',')[0];
        return (
          <g key={index}>
            <polygon
              fill={`url(#${gradient})`}
              points={`${first},180 ${points.join(' ')} ${last},180`}
            />
            <polyline
              fill="none"
              points={points.join(' ')}
              stroke={series.color}
              strokeLinejoin="round"
              strokeWidth="2.6"
              vectorEffect="non-scaling-stroke"
            />
            {points.length === 1 && (
              <circle
                cx={first}
                cy={points[0].split(',')[1]}
                fill={series.color}
                r="2"
              />
            )}
          </g>
        );
      })}
    </>
  );
}

function ChartBars({
  bucketMs,
  duration,
  index,
  series,
  total,
}: {
  bucketMs?: number;
  duration: number;
  index: number;
  series: ChartSeries;
  total: number;
}) {
  const max = Math.max(1, ...series.values);
  return (
    <g fill={series.color} opacity=".75">
      {series.values.map((value, bucket) => {
        if (value <= 0 || (series.counts && !series.counts[bucket])) {
          return null;
        }
        const height = Math.max(1, (value / max) * 156);
        const [start, end] = sliceBounds(
          bucket,
          series.values.length,
          duration,
          bucketMs,
        );
        const slot = ((end - start) / Math.max(duration, 1)) * 1000;
        const width = (slot * 0.8) / total;
        return (
          <rect
            height={height}
            key={bucket}
            rx="1"
            width={width}
            x={
              (start / Math.max(duration, 1)) * 1000 +
              slot * 0.1 +
              index * width
            }
            y={172 - height}
          />
        );
      })}
    </g>
  );
}

function activeIndex(
  hovered: number | undefined,
  selected: number | undefined,
) {
  return guideIndex(hovered, selected) ?? 0;
}

function tooltipValue(
  item: ChartSeries,
  active: number,
  sliceDuration: number,
) {
  if (item.unavailable) {
    return item.unavailable;
  }
  if (item.counts && !item.counts[active]) {
    return 'No samples';
  }
  const value = item.values[active] ?? 0;
  return item.rate
    ? `${item.format(value)} · ${(value / Math.max(sliceDuration / 1000, 0.000001)).toLocaleString(undefined, { maximumFractionDigits: 1 })} calls/s`
    : item.format(value);
}

function selectedRange(
  preview?: [number, number],
  committed?: [number, number],
) {
  return preview ?? committed;
}

function guideIndex(hovered: number | undefined, selected: number | undefined) {
  return hovered ?? selected;
}
function BucketGuide({
  bucketMs,
  count,
  duration,
  index,
}: {
  bucketMs?: number;
  count: number;
  duration: number;
  index?: number;
}) {
  if (index === undefined) {
    return null;
  }
  return (
    <line
      opacity=".3"
      stroke="currentColor"
      strokeDasharray="4 4"
      x1={sliceCenter(index, count, duration, bucketMs)}
      x2={sliceCenter(index, count, duration, bucketMs)}
      y1="0"
      y2="180"
    />
  );
}
function sliceBounds(
  index: number,
  count: number,
  duration: number,
  bucketMs?: number,
): [number, number] {
  return bucketMs
    ? [
        Math.min(duration, index * bucketMs),
        Math.min(duration, (index + 1) * bucketMs),
      ]
    : [(index / count) * duration, ((index + 1) / count) * duration];
}
function sliceCenter(
  index: number,
  count: number,
  duration: number,
  bucketMs?: number,
) {
  const [start, end] = sliceBounds(index, count, duration, bucketMs);
  return ((start + end) / 2 / Math.max(duration, 1)) * 1000;
}
