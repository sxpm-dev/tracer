import {
  baselineDelta,
  buildPerformanceReport,
  DURATION_BUCKETS,
  type PerformanceReportData,
  type ReportFunction,
  type ReportScenario,
  type ReportSection,
  type ReportSession,
} from './performanceReport';

const DEFAULT_SECTIONS: ReportSection[] = [
  'browser',
  'namespaces',
  'functions',
  'distributions',
  'cache',
  'quality',
];
const METRIC_HELP: Record<string, string> = {
  'Blocking ms/s':
    'Sum of recorded long-animation-frame blocking durations, or long-task fallback durations, divided by recording seconds.',
  'Cache hit rate':
    'Cache-hit markers divided by cache-hit plus cache-miss markers for the same namespace and function. Only paths with both marker types have a rate.',
  'Calls/s':
    'Traced call count divided by recording seconds. This is a rate, not a count of user actions.',
  'Event duration p95':
    'Nearest-rank 95th percentile of captured Event Timing durations. Collection is thresholded; this is not INP.',
  'Input delay p95':
    'Nearest-rank 95th percentile of captured input-delay samples. This is not INP.',
  'Recording %':
    'Namespace self milliseconds divided by recording milliseconds. Overlapping spans may make the sum exceed 100%.',
  'Root calls/s':
    'Calls with no recorded parent divided by recording seconds. A root is not necessarily a user action.',
  'Sampled FPS':
    'Mean of in-session requestAnimationFrame cadence samples. Visibility and display refresh rate affect it.',
  'Self ms/s':
    'Sum of recorded self milliseconds divided by recording seconds. Self time excludes the union of direct-child intervals; it is not CPU usage.',
  'Self share':
    'Namespace self milliseconds divided by all recorded self milliseconds. This denominator differs from recording duration.',
  'Timer lag p95':
    'Nearest-rank 95th percentile of monitoring timer delay samples; throttling can affect it.',
};
const escape = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const format = (value: null | number | undefined, digits = 1): string =>
  value == null || !Number.isFinite(value)
    ? 'Unavailable'
    : value.toLocaleString('en-US', { maximumFractionDigits: digits });
const pct = (value: null | number | undefined): string =>
  value == null ? 'Unavailable' : `${format(value, 1)}%`;
const summary = (
  item: ReportSession | undefined,
  selector: (item: ReportSession) => null | number,
): null | number => (item ? selector(item) : null);
const sectionOn = (
  data: PerformanceReportData,
  section: ReportSection,
): boolean => (data.config.sections ?? DEFAULT_SECTIONS).includes(section);
const sessionFor = (
  data: PerformanceReportData,
  scenario: ReportScenario,
  checkpoint: string,
): ReportSession | undefined => data.sessions[scenario.sessions[checkpoint]];
const label = (data: PerformanceReportData, namespace: string): string =>
  data.config.namespaceNames?.[namespace] ??
  (
    { 'editor-platform': 'Platform', 'responsive-editor': 'Editor' } as Record<
      string,
      string
    >
  )[namespace] ??
  namespace;
function metricInfo(name: string): string {
  const help = METRIC_HELP[name];
  return help
    ? `<details class="metric-info"><summary aria-label="About ${escape(name)}">ⓘ</summary><p>${escape(help)}</p></details>`
    : '';
}
function deltaCell(
  value: null | number,
  baseline: null | number,
  digits = 1,
): string {
  const delta = baselineDelta(value, baseline);
  return `<span>${format(value, digits)}</span>${delta === null ? '' : `<small class="delta">${delta > 0 ? '+' : ''}${format(delta, 1)}% vs baseline</small>`}`;
}
function metricRow(
  data: PerformanceReportData,
  scenario: ReportScenario,
  name: string,
  get: (item: ReportSession) => null | number,
  digits = 1,
): string {
  const baseline = summary(
    sessionFor(data, scenario, scenario.baselineCheckpointId),
    get,
  );
  return `<tr><th scope="row">${escape(name)}${metricInfo(name)}</th>${scenario.checkpoints
    .map((checkpoint) => {
      const item = sessionFor(data, scenario, checkpoint.id);
      if (!item) {
        return '<td class="unavailable">Missing recording</td>';
      }
      const value = get(item);
      return `<td>${checkpoint.id === scenario.baselineCheckpointId ? format(value, digits) : deltaCell(value, baseline, digits)}</td>`;
    })
    .join('')}</tr>`;
}
function table(
  data: PerformanceReportData,
  scenario: ReportScenario,
  rows: string,
  title: string,
): string {
  return `<div class="table-scroll"><table><caption>${escape(title)}</caption><thead><tr><th scope="col">Measure</th>${scenario.checkpoints.map((cp) => `<th scope="col">${escape(cp.name)}${cp.id === scenario.baselineCheckpointId && cp.name.toLowerCase() !== 'baseline' ? ' <small>Baseline</small>' : ''}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function browserMetric(
  item: ReportSession,
  metric: string,
  field: 'mean' | 'p95',
): null | number {
  return item.browser.find((entry) => entry.metric === metric)?.[field] ?? null;
}
function browserSection(
  data: PerformanceReportData,
  scenario: ReportScenario,
): string {
  const rows = [
    metricRow(data, scenario, 'Sampled FPS', (s) =>
      browserMetric(s, 'frame.fps', 'mean'),
    ),
    metricRow(
      data,
      scenario,
      'Long-frame / task count',
      (s) => s.blockingCount,
      0,
    ),
    metricRow(data, scenario, 'Blocking ms/s', (s) =>
      s.blockingMs === null
        ? null
        : s.seconds > 0
          ? s.blockingMs / s.seconds
          : null,
    ),
    metricRow(data, scenario, 'Input delay p95', (s) =>
      browserMetric(s, 'event.input-delay', 'p95'),
    ),
    metricRow(data, scenario, 'Event duration p95', (s) =>
      browserMetric(s, 'event.duration', 'p95'),
    ),
    metricRow(data, scenario, 'Timer lag p95', (s) =>
      browserMetric(s, 'timer.lag', 'p95'),
    ),
  ].join('');
  const all = [
    ...new Set(
      scenario.checkpoints.flatMap(
        (cp) =>
          sessionFor(data, scenario, cp.id)?.browser.map((m) => m.metric) ?? [],
      ),
    ),
  ];
  const detailRows = all
    .map(
      (metric) =>
        `<tr><th scope="row">${escape(metric)}</th>${scenario.checkpoints
          .map((cp) => {
            const item = sessionFor(data, scenario, cp.id)?.browser.find(
              (m) => m.metric === metric,
            );
            return `<td>${item ? `${format(item.mean)} ${escape(item.unit)} mean · ${format(item.p95)} p95 · ${format(item.count, 0)} samples` : 'Unavailable'}</td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return numbered(
    'Browser responsiveness',
    table(data, scenario, rows, 'Browser signals') +
      (detailRows
        ? `<details><summary>All captured browser metrics</summary>${table(data, scenario, detailRows, 'Captured browser metrics')}</details>`
        : ''),
  );
}
function namespaceSection(
  data: PerformanceReportData,
  scenario: ReportScenario,
): string {
  const namespaces = [
    ...new Set(
      scenario.checkpoints.flatMap(
        (cp) =>
          sessionFor(data, scenario, cp.id)?.namespaces?.map(
            (ns) => ns.namespace,
          ) ?? [],
      ),
    ),
  ];
  const rows = namespaces
    .filter(
      (namespace) =>
        !data.config.selectedNamespaces ||
        data.config.selectedNamespaces.includes(namespace),
    )
    .map((ns) => {
      const values = scenario.checkpoints.map((cp) =>
        sessionFor(data, scenario, cp.id)?.namespaces?.find(
          (item) => item.namespace === ns,
        ),
      );
      return `<tr><th scope="row"><span class="badge" style="--badge:${namespaceColor(ns)}">${escape(label(data, ns))}</span></th>${values.map((item) => `<td>${item ? `<strong>${format(item.calls, 0)} calls</strong><small>${format(item.callsPerSecond)} calls/s · ${pct(item.callSharePct)} of all calls</small><small>${format(item.roots, 0)} roots · ${format(item.rootsPerSecond)} roots/s</small><small>${format(item.selfMs)} self ms · ${format(item.selfMsPerSecond)} self ms/s</small><small>${pct(item.selfSharePct)} of recorded self · ${pct(item.recordingPct)} of recording</small>` : 'Unavailable'}</td>`).join('')}</tr>`;
    })
    .join('');
  return numbered(
    'Namespace work',
    table(
      data,
      scenario,
      rows || '<tr><td>No function measurements</td></tr>',
      'Namespace totals and rates',
    ),
  );
}
function namespaceColor(namespace: string): string {
  const friendly =
    namespace === 'responsive-editor'
      ? '#8b6ce7'
      : namespace === 'editor-platform'
        ? '#279eb0'
        : '';
  if (friendly) {
    return friendly;
  }
  let hash = 0;
  for (const char of namespace) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 57% 50%)`;
}
function functionValue(
  fn: ReportFunction | undefined,
  metric: string,
  mode: string,
): null | number {
  if (!fn) {
    return null;
  }
  if (mode === 'root') {
    if (metric === 'calls') {
      return fn.rootCalls;
    }
    if (metric === 'inclusiveMs') {
      return fn.rootInclusiveMs;
    }
    if (metric === 'selfMs') {
      return fn.rootSelfMs;
    }
    return fn.rootTreeCalls;
  }
  return metric === 'rootTreeCalls'
    ? fn.rootTreeCalls
    : fn[metric as 'calls' | 'inclusiveMs' | 'selfMs'];
}
function rankingVariant(
  data: PerformanceReportData,
  scenario: ReportScenario,
  metric: 'calls' | 'inclusiveMs' | 'rootTreeCalls' | 'selfMs',
  mode: 'all' | 'root',
  namespace: string,
): string {
  const sessions = scenario.checkpoints.map((cp) =>
    sessionFor(data, scenario, cp.id),
  );
  const lookups = sessions.map(
    (item) => new Map(item?.functions?.map((fn) => [fn.key, fn]) ?? []),
  );
  const union = new Map<string, ReportFunction>();
  for (const item of sessions) {
    for (const fn of item?.functions ?? []) {
      if (
        !data.config.selectedNamespaces ||
        data.config.selectedNamespaces.includes(fn.namespace)
      ) {
        union.set(fn.key, fn);
      }
    }
  }
  const rankValue = (key: string) =>
    Math.max(
      ...lookups.map(
        (lookup) => functionValue(lookup.get(key), metric, mode) ?? 0,
      ),
    );
  const ranked = [...union.values()]
    .filter((fn) => namespace === 'all' || fn.namespace === namespace)
    .filter((fn) => rankValue(fn.key) > 0)
    .sort(
      (a, b) =>
        rankValue(b.key) - rankValue(a.key) || a.key.localeCompare(b.key),
    )
    .slice(0, 8);
  const rows = ranked
    .map((fn) => {
      const values = lookups.map((lookup) => lookup.get(fn.key));
      return `<tr><th scope="row"><span class="badge" style="--badge:${namespaceColor(fn.namespace)}">${escape(label(data, fn.namespace))}</span><code>${escape(fn.name)}</code></th>${values
        .map((value, index) =>
          rankingCell(value, sessions[index], metric, mode),
        )
        .join('')}</tr>`;
    })
    .join('');
  return `<div class="ranking-variant" data-mode="${mode}" data-namespace="${escape(namespace)}" ${mode === 'root' && namespace === 'all' ? '' : 'hidden'}>${table(data, scenario, rows || '<tr><td>No observed functions for this filter.</td></tr>', 'Top functions')}</div>`;
}
function rankingCell(
  value: ReportFunction | undefined,
  session: ReportSession | undefined,
  metric: string,
  mode: string,
): string {
  if (!session?.functions) {
    return '<td>Unavailable</td>';
  }
  if (!value) {
    return '<td>Not observed</td>';
  }
  const amount = functionValue(value, metric, mode);
  const denominator = callDenominator(session, metric, mode);
  const share =
    denominator && amount !== null ? (100 * amount) / denominator : null;
  return `<td><strong>${format(amount, metric === 'calls' || metric === 'rootTreeCalls' ? 0 : 1)}</strong>${share === null ? '' : `<small>${pct(share)} of ${mode === 'root' ? 'all root calls' : 'all calls'}</small><span class="cell-bar" style="width:${Math.min(100, share)}%" aria-hidden="true"></span>`}</td>`;
}
function callDenominator(
  session: ReportSession,
  metric: string,
  mode: string,
): null | number {
  if (metric !== 'calls') {
    return null;
  }
  return mode === 'root' ? session.roots : session.calls;
}
function functionSection(
  data: PerformanceReportData,
  scenario: ReportScenario,
): string {
  const sessions = scenario.checkpoints.map((cp) =>
    sessionFor(data, scenario, cp.id),
  );
  const namespaces = [
    ...new Set(
      sessions.flatMap(
        (item) => item?.functions?.map((fn) => fn.namespace) ?? [],
      ),
    ),
  ];
  const included = namespaces.filter(
    (namespace) =>
      !data.config.selectedNamespaces ||
      data.config.selectedNamespaces.includes(namespace),
  );
  const metrics: {
    key: 'calls' | 'inclusiveMs' | 'rootTreeCalls' | 'selfMs';
    title: string;
  }[] = [
    { key: 'calls', title: 'Most called functions' },
    { key: 'inclusiveMs', title: 'Highest inclusive duration' },
    { key: 'selfMs', title: 'Highest recorded self duration' },
    { key: 'rootTreeCalls', title: 'Root call-tree volume' },
  ];
  return numbered(
    'Function rankings',
    `<p>Inclusive duration contains child work and overlaps across calls. Root mode uses root-only call counts and durations; a root is any call without a recorded parent.</p>${metrics
      .map(
        ({ key, title }) => `
    <section class="ranking-widget" data-mode="root" data-namespace="all"><h3>${title}</h3>
      <div class="ranking-controls" role="group" aria-label="${title} filters">
        <span>Call scope</span><button type="button" data-ranking-filter="mode" data-value="root" aria-pressed="true">Root calls</button><button type="button" data-ranking-filter="mode" data-value="all" aria-pressed="false">All function calls</button>
        <span>Namespace</span><button type="button" data-ranking-filter="namespace" data-value="all" aria-pressed="true">All</button>${included.map((ns) => `<button type="button" data-ranking-filter="namespace" data-value="${escape(ns)}" aria-pressed="false">${escape(label(data, ns))}</button>`).join('')}
      </div>${(['root', 'all'] as const).flatMap((mode) => ['all', ...included].map((ns) => rankingVariant(data, scenario, key, mode, ns))).join('')}
    </section>`,
      )
      .join('')}`,
  );
}
function distributionSection(
  data: PerformanceReportData,
  scenario: ReportScenario,
): string {
  const labels = [
    '<1 ms',
    '1–<4 ms',
    '4–<16.67 ms',
    '16.67–<50 ms',
    '50–<100 ms',
    '100–<500 ms',
    '≥500 ms',
  ];
  const rows = labels
    .map(
      (name, index) =>
        `<tr><th scope="row">${escape(name)}</th>${scenario.checkpoints
          .map((cp) => {
            const item = sessionFor(data, scenario, cp.id);
            if (!item?.functions) {
              return '<td>Unavailable</td>';
            }
            const all = item.functions.reduce(
              (sum, fn) => sum + fn.buckets[index],
              0,
            );
            const roots = item.functions.reduce(
              (sum, fn) => sum + fn.rootBuckets[index],
              0,
            );
            return `<td>${format(all, 0)} calls<small>${format(roots, 0)} root calls</small></td>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  return numbered(
    'Duration distributions',
    `<p>Buckets use half-open intervals: each call belongs to exactly one bucket. Bounds: ${DURATION_BUCKETS.join(', ')} ms.</p>${table(data, scenario, rows, 'Call duration buckets')}`,
  );
}
function cacheSection(
  data: PerformanceReportData,
  scenario: ReportScenario,
): string {
  const keys = [
    ...new Set(
      scenario.checkpoints.flatMap(
        (cp) =>
          sessionFor(data, scenario, cp.id)?.cache?.map((c) => c.key) ?? [],
      ),
    ),
  ];
  const rows = keys
    .map((key) => {
      const cache = scenario.checkpoints.map((cp) =>
        sessionFor(data, scenario, cp.id)?.cache?.find((c) => c.key === key),
      );
      const first = cache.find(Boolean)!;
      return `<tr><th scope="row"><span class="badge" style="--badge:${namespaceColor(first.namespace)}">${escape(label(data, first.namespace))}</span><code>${escape(first.name)}</code></th>${cache.map((item) => `<td>${item ? `${format(item.hits, 0)} hits · ${format(item.misses, 0)} misses<small>${item.hitRate === null ? 'Hit rate unavailable: marker coverage incomplete' : `${pct(item.hitRate * 100)} hit rate`}</small>` : 'Not observed'}</td>`).join('')}</tr>`;
    })
    .join('');
  return numbered(
    'Cache observations',
    keys.length
      ? table(data, scenario, rows, 'Cache marker outcomes')
      : '<p>No compatible cache hit/miss markers were recorded.</p>',
  );
}
function qualitySection(
  data: PerformanceReportData,
  scenario: ReportScenario,
): string {
  return numbered(
    'Coverage and provenance',
    `<ul>${scenario.checkpoints
      .map((cp) => {
        const item = sessionFor(data, scenario, cp.id);
        return `<li><strong>${escape(cp.name)}:</strong> ${item ? `${escape(item.sessionId)} · ${escape(item.mode ?? 'full')} capture · ${escape(item.startedAt)} · calculation v${item.calculationVersion}. ${item.coverageNotes.map(escape).join(' ')}` : 'Missing recording.'}</li>`;
      })
      .join(
        '',
      )}</ul><p>Different capture modes or instrumented methods can change measurement scope. Percentage changes describe observed measurements, not proven causes.</p>`,
  );
}
function numbered(title: string, body: string): string {
  return `<details class="section-disclosure"><summary><h2>${escape(title)}</h2><span>Show detail</span></summary><div class="section-body">${body}</div></details>`;
}
function authored(data: PerformanceReportData): string {
  const analysis = data.config.analysis;
  if (!analysis) {
    return '';
  }
  const items: [string, string[] | undefined][] = [
    ['Conclusions', analysis.conclusions],
    ['Implemented changes', analysis.implementedChanges],
    ['Remaining expensive flows', analysis.remainingExpensiveFlows],
    ['Further investigation', analysis.furtherInvestigation],
  ];
  return items
    .filter(([, values]) => values?.length)
    .map(([name, values]) =>
      numbered(
        name,
        `<ul>${values!.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>`,
      ),
    )
    .join('');
}
function scenarioPanel(
  data: PerformanceReportData,
  scenario: ReportScenario,
  index: number,
): string {
  const rows = [
    metricRow(data, scenario, 'Recording seconds', (s) => s.seconds, 2),
    metricRow(data, scenario, 'All traced calls', (s) => s.calls, 0),
    metricRow(data, scenario, 'Calls/s', (s) => s.callsPerSecond),
    metricRow(data, scenario, 'Root calls', (s) => s.roots, 0),
    metricRow(data, scenario, 'Root calls/s', (s) => s.rootsPerSecond),
    metricRow(data, scenario, 'Recorded self ms', (s) => s.selfMs),
    metricRow(data, scenario, 'Self ms/s', (s) => s.selfMsPerSecond),
    metricRow(data, scenario, 'Errors', (s) => s.errors, 0),
  ].join('');
  const meta = scenario.checkpoints
    .map((cp) => {
      const session = sessionFor(data, scenario, cp.id);
      return `<div class="checkpoint"><strong>${escape(cp.name)}</strong>${session?.title && session.title !== cp.name ? `<span>${escape(session.title)}</span>` : ''}<small>${escape(scenario.sessions[cp.id] ?? 'No recording assigned')}</small>${cp.description ? `<p>${escape(cp.description)}</p>` : ''}${cp.build ? `<small>Build / commit: ${escape(cp.build)}</small>` : ''}${cp.notes ? `<p>${escape(cp.notes)}</p>` : ''}</div>`;
    })
    .join('');
  return `<section id="scenario-${index}" class="scenario-panel" role="tabpanel" aria-labelledby="tab-${index}" ${index ? 'hidden' : ''}>
    <h2>${escape(scenario.name)}</h2>${scenario.description ? `<p>${escape(scenario.description)}</p>` : ''}${scenario.steps ? `<p><strong>Reproduction:</strong> ${escape(scenario.steps)}</p>` : ''}
    <div class="checkpoint-grid">${meta}</div><div class="summary-card"><h2>At a glance</h2>${table(data, scenario, rows, 'Session summary')}</div>
    ${sectionOn(data, 'browser') ? browserSection(data, scenario) : ''}
    ${sectionOn(data, 'namespaces') ? namespaceSection(data, scenario) : ''}
    ${sectionOn(data, 'functions') ? functionSection(data, scenario) : ''}
    ${sectionOn(data, 'distributions') ? distributionSection(data, scenario) : ''}
    ${sectionOn(data, 'cache') ? cacheSection(data, scenario) : ''}
    ${sectionOn(data, 'quality') ? qualitySection(data, scenario) : ''}
    ${authored(data)}
  </section>`;
}

/** The UI and CLI both call this pure renderer. No network, fonts, or runtime assets. */
export function renderPerformanceReport(
  data: PerformanceReportData,
  initialTheme: 'dark' | 'light' = 'dark',
): string {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/\u2028|\u2029/g, ' ');
  return `<!doctype html><html lang="en" data-theme="${initialTheme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(data.config.title ?? 'Performance report')}</title><style>${REPORT_CSS}</style></head><body>
  <main><header class="report-header"><div><span class="eyebrow">TRACE EVIDENCE · CALCULATION V${data.calculationVersion}</span><h1>${escape(data.config.title ?? 'Performance report')}</h1><p>Recorded behavior across ${data.config.scenarios.length} scenario${data.config.scenarios.length === 1 ? '' : 's'}. Values come from captured traces and browser samples; interpretations appear only when supplied by an author.</p></div><div class="header-actions"><button type="button" id="theme">${initialTheme === 'dark' ? 'Light' : 'Dark'} appearance</button><button type="button" id="print">Print / PDF</button><button type="button" id="evidence">Download evidence JSON</button></div></header>
  ${data.warnings.length ? `<aside class="warnings" role="note"><strong>Comparison and coverage notes</strong><ul>${data.warnings.map((warning) => `<li>${escape(warning)}</li>`).join('')}</ul></aside>` : ''}
  <div class="scenario-tabs"><div class="scenario-tablist" role="tablist" aria-label="Scenarios">${data.config.scenarios.map((scenario, index) => `<button id="tab-${index}" type="button" role="tab" aria-controls="scenario-${index}" aria-selected="${index === 0}" tabindex="${index ? -1 : 0}">${escape(scenario.name)}</button>`).join('')}</div>${data.config.scenarios.map((scenario, index) => scenarioPanel(data, scenario, index)).join('')}</div>
  <footer>Recording identifiers and calculation version are listed in Coverage and provenance. This report is self-contained and works offline.</footer></main>
  <script id="report-data" type="application/json">${json}</script><script>${REPORT_JS}</script></body></html>`;
}

export function renderReportFromEvidence(
  config: PerformanceReportData['config'],
  evidence: PerformanceReportData['sessions'][string][],
): string {
  return renderPerformanceReport(buildPerformanceReport(config, evidence));
}

const REPORT_CSS = `
:root{color-scheme:dark;--bg:#10141d;--surface:#1b2230;--surface2:#232d3b;--text:#e9eff7;--muted:#aeb9c7;--line:#384456;--accent:#89b4fa;--bar:#467cb9}html[data-theme=light]{color-scheme:light;--bg:#f5f7fb;--surface:#fff;--surface2:#eef2f8;--text:#1c2735;--muted:#57677b;--line:#d6deea;--accent:#255aa2;--bar:#a9c9eb}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}main{max-width:1180px;margin:0 auto;padding:32px 24px 80px}h1{font-size:clamp(2rem,4vw,3rem);line-height:1.12;margin:.4rem 0}h2{font-size:1.25rem}h3{font-size:1.05rem}p{margin:.5rem 0 1rem;color:var(--muted)}button{font:inherit;cursor:pointer;border:1px solid var(--line);color:var(--text);background:var(--surface);border-radius:8px;padding:7px 12px}button:hover,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button[aria-pressed=true],button[aria-selected=true]{background:var(--accent);color:var(--bg);border-color:var(--accent)}.report-header{display:flex;justify-content:space-between;align-items:flex-start;gap:30px;padding-bottom:25px;border-bottom:1px solid var(--line)}.report-header>div:first-child{max-width:720px}.header-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.eyebrow{color:var(--accent);font-size:.73rem;font-weight:700;letter-spacing:.15em}.warnings,.summary-card,.checkpoint,.section-disclosure{background:var(--surface);border:1px solid var(--line);border-radius:14px}.warnings{padding:12px 20px;margin:20px 0}.warnings ul{margin:.3rem 0}.scenario-tablist{display:flex;gap:8px;overflow:auto;margin:24px 0}.scenario-panel[hidden],.ranking-variant[hidden]{display:none}.checkpoint-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin:20px 0}.checkpoint{padding:15px}.checkpoint small,.checkpoint p{display:block;color:var(--muted);margin:.15rem 0}.summary-card{padding:16px 20px;margin:18px 0 24px}.summary-card h2{margin:0 0 10px}.section-disclosure{margin:12px 0}.section-disclosure>summary{display:flex;align-items:center;justify-content:space-between;padding:17px 20px;cursor:pointer;list-style:none}.section-disclosure>summary h2{margin:0}.section-disclosure>summary span{color:var(--muted);font-size:.85rem}.section-body{padding:0 20px 20px;border-top:1px solid var(--line)}.table-scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;min-width:650px}caption{text-align:left;color:var(--muted);font-size:.85rem;padding:10px 0}th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}th{font-weight:600}thead th{white-space:nowrap;background:var(--surface2)}td small{display:block;color:var(--muted)}.delta{color:var(--accent)}.unavailable{color:var(--muted)}.badge{display:inline-block;border:1px solid var(--badge);border-radius:99px;padding:1px 8px;color:var(--badge);font-size:.72rem;margin-right:7px;white-space:nowrap}code{font:.82rem ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}.ranking-widget{margin:22px 0;padding-top:10px;border-top:1px solid var(--line)}.ranking-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:10px 0}.ranking-controls span{font-size:.76rem;color:var(--muted);margin-left:10px}.ranking-controls button{font-size:.78rem;padding:5px 10px}.cell-bar{display:block;height:5px;background:var(--bar);border-radius:5px;min-width:1px;margin-top:4px}.metric-info{display:inline-block;margin-left:6px;position:relative;font-weight:400}.metric-info summary{display:inline;cursor:pointer;color:var(--accent);list-style:none}.metric-info p{position:absolute;z-index:3;width:min(280px,80vw);background:var(--surface2);color:var(--text);padding:10px;border:1px solid var(--line);border-radius:8px;box-shadow:0 4px 20px #0005}footer{border-top:1px solid var(--line);margin-top:35px;padding-top:18px;color:var(--muted);font-size:.82rem}@media(max-width:700px){main{padding:18px 12px}.report-header{display:block}.header-actions{justify-content:flex-start;margin-top:16px}.section-disclosure>summary{padding:12px}.section-body{padding:0 10px 12px}}@media print{html{color-scheme:light}body{background:white;color:#111}.header-actions,.ranking-controls{display:none}.scenario-panel[hidden]{display:block}.ranking-variant[hidden]{display:none}.scenario-panel{page-break-before:always}.section-disclosure{break-inside:avoid}.section-disclosure>.section-body{display:block}.scenario-tablist{display:none}table{font-size:10px}.section-disclosure,.summary-card,.checkpoint{border-color:#bbb}}
/* Keep the standalone report close to the reference reports' reading layout. */
:root{--bg:#17191b;--surface:#25282b;--surface2:#30353a;--text:#f2f4f6;--muted:#c2c9d0;--line:#3b4248;--accent:#8caeff;--bar:#8caeff}
html[data-theme=light]{--bg:#f4f5f7;--surface:#fff;--surface2:#edf0f4;--text:#202832;--muted:#5d6975;--line:#dce1e7;--accent:#315fa8;--bar:#93b6ec}
body{font-size:14px;line-height:1.6}
main{max-width:1180px;padding:28px 30px 80px}
h1{font-size:clamp(1.8rem,2.8vw,2.3rem);letter-spacing:-.04em;line-height:1.2}
.report-header{align-items:flex-start;gap:24px;padding-bottom:22px}
.report-header p{max-width:680px;margin:8px 0 0}
.eyebrow{font-size:.68rem;letter-spacing:.16em}
.scenario-tablist{margin:18px 0}
.scenario-panel>h2{font-size:1.15rem}
.checkpoint-grid{margin:16px 0 24px}
.checkpoint{border-radius:10px;padding:17px 18px}
.checkpoint span{display:block;margin:5px 0 2px;font-size:.9rem;font-weight:500}
.summary-card{border-top:3px solid var(--accent);padding:20px 24px}
.summary-card h2{font-size:1.15rem}
.section-disclosure{border-radius:10px}
.section-disclosure>summary{padding:18px 22px}
.section-body{padding:0 22px 22px}
table{min-width:560px}
th,td{padding:10px 12px}
thead th{font-size:.85rem}
@media(max-width:700px){main{padding:18px 14px 60px}.summary-card{padding:16px}.section-body{padding:0 12px 16px}}
`;
const REPORT_JS = `
const data=JSON.parse(document.getElementById('report-data').textContent);
const tabs=[...document.querySelectorAll('[role=tab]')];function activate(tab){tabs.forEach(t=>{const selected=t===tab;t.setAttribute('aria-selected',String(selected));t.tabIndex=selected?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!selected})}tabs.forEach((tab,index)=>{tab.onclick=()=>activate(tab);tab.onkeydown=e=>{let next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;else if(e.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=tabs.length-1;else return;e.preventDefault();activate(tabs[next]);tabs[next].focus()}});
for(const widget of document.querySelectorAll('.ranking-widget'))for(const button of widget.querySelectorAll('[data-ranking-filter]'))button.onclick=()=>{const filter=button.dataset.rankingFilter;widget.dataset[filter]=button.dataset.value;for(const control of widget.querySelectorAll('[data-ranking-filter="'+filter+'"]'))control.setAttribute('aria-pressed',String(control===button));for(const variant of widget.querySelectorAll('.ranking-variant'))variant.hidden=variant.dataset.mode!==widget.dataset.mode||variant.dataset.namespace!==widget.dataset.namespace};
document.getElementById('theme').onclick=()=>{const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';document.getElementById('theme').textContent=light?'Dark appearance':'Light appearance'};document.getElementById('print').onclick=()=>print();document.getElementById('evidence').onclick=()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='performance-report-evidence.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
let open=[];addEventListener('beforeprint',()=>{open=[...document.querySelectorAll('details')].map(d=>[d,d.open]);open.forEach(([d])=>d.open=true)});addEventListener('afterprint',()=>{open.forEach(([d,state])=>d.open=state);open=[]});
`;
