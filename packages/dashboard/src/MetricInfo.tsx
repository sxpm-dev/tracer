import { useEffect, useId, useRef, useState } from 'react';

import { DashboardIcon } from './DashboardIcon';
import { METRIC_CAPTURE_EXAMPLES } from './metricCaptureExamples';

export interface MetricHelp {
  capture: string;
  chart: string;
  meaning: string;
  presentation?: 'list';
}
export const METRIC_HELP: Record<string, MetricHelp> = {
  'cpu.pressure': {
    capture:
      'Opt-in PressureObserver capture in a supported secure context, with a requested sampling interval of at least one second. Browser support and permissions determine availability.',
    chart: 'The highest captured pressure level is shown in each time slice.',
    meaning:
      'A browser-reported pressure level: Nominal, Fair, Serious, or Critical. It is not a CPU percentage or attribution to one function.',
  },
  'event.duration': {
    capture:
      'PerformanceObserver observes event timing entries with a requested duration threshold of 16 ms and records entry.duration. Not every event is reported by the browser.',
    chart: 'The longest observed event duration is shown in each time slice.',
    meaning:
      'The duration of an observed interaction event, including input waiting, event processing, and presentation delay. This chart is not an INP calculation.',
  },
  'event.input-delay': {
    capture:
      'For captured Event Timing entries, the recorder subtracts startTime from processingStart.',
    chart: 'The largest observed input delay is shown in each time slice.',
    meaning:
      'How long an input event waited before the browser started processing it.',
  },
  'event.processing': {
    capture:
      'For captured Event Timing entries, the recorder subtracts processingStart from processingEnd.',
    chart:
      'The longest observed processing duration is shown in each time slice.',
    meaning:
      'Time spent processing an observed event, excluding the wait before processing and subsequent presentation delay.',
  },
  'frame.fps': {
    capture:
      'The recorder counts requestAnimationFrame callbacks over a sampling window and divides by elapsed time in seconds.',
    chart: 'Captured frame-rate samples are averaged in each time slice.',
    meaning:
      'The observed rate of animation-frame callbacks. Background throttling and display refresh rate can affect it.',
  },
  'layout.shift': {
    capture:
      'PerformanceObserver records layout-shift entries, excluding entries marked hadRecentInput.',
    chart:
      'The largest individual layout-shift score is shown in each time slice.',
    meaning:
      'A score for unexpected movement of visible page content. This chart is not the cumulative CLS score.',
  },
  'memory.js-heap-high-water': {
    capture:
      'When per-call memory capture is enabled, the recorder reads performance.memory.usedJSHeapSize at call boundaries. This series uses each call’s endBytes measurement.',
    chart:
      'The largest captured end-of-call heap value is shown in each time slice.',
    meaning:
      'The largest observed JavaScript heap measurement at traced call completion. It does not measure memory allocated by that function or the true peak between samples.',
  },
  'memory.js-heap-used': {
    capture:
      'The recorder periodically reads performance.memory.usedJSHeapSize when available. This is a non-standard Chromium API.',
    chart: 'Captured heap samples are averaged in each time slice.',
    meaning:
      'An estimate of JavaScript heap currently in use. It is not the browser process’s total memory.',
  },
  'memory.ua-total': {
    capture:
      'The recorder calls performance.measureUserAgentSpecificMemory in supported, cross-origin-isolated contexts. Measurements are requested no more often than every five seconds, with only one request in flight.',
    chart: 'Captured memory estimates are averaged in each time slice.',
    meaning:
      'The browser’s estimate of memory associated with the page and its related contexts. It covers more than just JavaScript heap.',
  },
  'page.visibility': {
    capture:
      'The recorder reads document.visibilityState initially and on visibilitychange, recording visible as 1 and hidden as 0.',
    chart:
      'State samples are averaged within a slice and displayed as Visible at 0.5 or above. Empty slices are not carried forward.',
    meaning:
      'Whether the document was visible or hidden when its visibility was recorded.',
  },
  'resource.duration': {
    capture:
      'PerformanceObserver records resource timing entries meeting the configured minimum duration (50 ms by default).',
    chart:
      'The longest captured resource duration is shown in each time slice.',
    meaning:
      'Elapsed loading time of an observed resource, rather than total page-load time.',
  },
  'resource.transfer-size': {
    capture:
      'The recorder takes transferSize from the same Resource Timing entries used for resource duration.',
    chart:
      'The largest captured resource transfer is shown per slice, not the sum of transferred bytes.',
    meaning:
      'The transfer size reported for a captured resource, including response headers and body. Cache behavior or cross-origin restrictions can result in zero.',
  },
  'thread.blocking': {
    capture:
      'PerformanceObserver records long animation frames using blockingDuration (or duration minus 50 ms when unavailable). The long-task fallback records the full task duration.',
    chart: 'Recorded blocking durations are summed in each time slice.',
    meaning:
      'Time during which long browser work can delay interaction. This is not CPU utilization.',
  },
  'timer.lag': {
    capture:
      'A repeating timer compares performance.now with its expected next callback time and records the non-negative difference.',
    chart: 'The largest captured timer delay is shown in each time slice.',
    meaning:
      'How late a scheduled timer callback ran. Main-thread work and browser throttling can both increase it.',
  },
};

export function MetricInfo({
  help: providedHelp,
  metric,
  title,
}: {
  help?: MetricHelp;
  metric: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef(false);
  const id = useId();
  const help = providedHelp ?? METRIC_HELP[metric];
  useEffect(() => {
    if (open) {
      dialog.current?.showModal();
    }
  }, [open]);
  return (
    <>
      <button
        aria-label={`About ${title}`}
        className="cd-icon-button cd-metric-info-button"
        onClick={() => setOpen(true)}
        type="button"
      >
        <DashboardIcon name="info" size={18} />
      </button>
      {open && (
        <dialog
          aria-labelledby={id}
          className="cd-metric-info-dialog"
          onClick={(event) => {
            if (backdropPointer.current && isBackdropEvent(event)) {
              event.currentTarget.close();
            }
            backdropPointer.current = false;
          }}
          onClose={() => setOpen(false)}
          onPointerCancel={() => {
            backdropPointer.current = false;
          }}
          onPointerDown={(event) => {
            backdropPointer.current = isBackdropEvent(event);
          }}
          ref={dialog}
        >
          <header>
            <h2 id={id}>{title}</h2>
            <button
              aria-label="Close metric information"
              autoFocus
              className="cd-icon-button"
              onClick={() => dialog.current?.close()}
              type="button"
            >
              <DashboardIcon name="close" />
            </button>
          </header>
          <MetricInfoContent help={help} metric={metric} />
        </dialog>
      )}
    </>
  );
}

function MetricInfoContent({
  help,
  metric,
}: {
  help?: MetricHelp;
  metric: string;
}) {
  return (
    <>
      <h3>What it measures</h3>
      <p>{help?.meaning ?? 'A metric supplied by the recording producer.'}</p>
      <h3>How it is captured</h3>
      <p>
        {help?.capture ?? 'Capture details are not provided for this metric.'}
      </p>
      <CaptureExample metric={metric} />
      <MetricReadingHelp help={help} />
      <p className="cd-table-hint">
        Sample recordings contain synthetic values for demonstration. Live
        capture depends on the recording settings and browser capabilities.
      </p>
    </>
  );
}

function MetricReadingHelp({ help }: { help?: MetricHelp }) {
  return (
    <>
      <h3>
        {help?.presentation === 'list'
          ? 'How to read the list'
          : 'How to read the chart'}
      </h3>
      <p>
        {help?.chart ?? 'Values are grouped into time slices.'}{' '}
        {help?.presentation !== 'list' &&
          'Empty slices have no captured samples.'}
      </p>
    </>
  );
}

function isBackdropEvent(event: {
  clientX: number;
  clientY: number;
  currentTarget: HTMLDialogElement;
  target: EventTarget;
}): boolean {
  if (event.target !== event.currentTarget) {
    return false;
  }
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}

function CaptureExample({ metric }: { metric: string }) {
  const code = METRIC_CAPTURE_EXAMPLES[metric];
  if (!code) {
    return null;
  }
  return (
    <div className="cd-capture-example">
      <p>
        Simplified JavaScript example. <code>record(value, time)</code>{' '}
        represents saving a sample; times are converted to recording-relative
        timestamps. Support checks, capture settings, and error handling are
        omitted.
      </p>
      <pre aria-label="Capture code example">
        <code>{code}</code>
      </pre>
    </div>
  );
}
