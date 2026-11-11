import type { TraceRecording } from './types';

export const REPORT_CALCULATION_VERSION = 1;
export const DURATION_BUCKETS = [1, 4, 16.67, 50, 100, 500] as const;

export interface ReportCheckpoint {
  build?: string;
  description?: string;
  id: string;
  name: string;
  notes?: string;
}
export interface ReportScenario {
  baselineCheckpointId: string;
  checkpoints: ReportCheckpoint[];
  description?: string;
  id: string;
  name: string;
  /** A missing entry is an intentionally missing recording. */
  sessions: Record<string, string>;
  steps?: string;
}
export interface ReportAnalysis {
  conclusions?: string[];
  furtherInvestigation?: string[];
  implementedChanges?: string[];
  remainingExpensiveFlows?: string[];
}
export type ReportSection =
  | 'browser'
  | 'cache'
  | 'distributions'
  | 'functions'
  | 'namespaces'
  | 'quality';
export interface PerformanceReportConfig {
  analysis?: ReportAnalysis;
  namespaceNames?: Record<string, string>;
  scenarios: ReportScenario[];
  sections?: ReportSection[];
  selectedNamespaces?: string[];
  title?: string;
  version: 1;
}
export interface ReportFunction {
  buckets: number[];
  calls: number;
  errors: number;
  inclusiveMs: number;
  key: string;
  name: string;
  namespace: string;
  rootBuckets: number[];
  rootCalls: number;
  rootInclusiveMs: number;
  rootSelfMs: number;
  rootTreeCalls: number;
  selfMs: number;
}
export interface ReportBrowserMetric {
  count: number;
  max: null | number;
  mean: null | number;
  metric: string;
  p50: null | number;
  p95: null | number;
  total: number;
  unit: string;
}
export interface ReportCacheMetric {
  hitRate: null | number;
  hits: number;
  key: string;
  misses: number;
  name: string;
  namespace: string;
}
export interface ReportEvidence {
  aggregateFunctions?: {
    calls: number;
    errors: number;
    inclusiveMs: number;
    name: string;
    namespace: string;
  }[];
  blockingCount: null | number;
  blockingMs: null | number;
  browser: ReportBrowserMetric[];
  browserCapabilities?: TraceRecording['browserCapabilities'];
  cache: null | ReportCacheMetric[];
  calculationVersion: number;
  coverageNotes: string[];
  droppedBrowserSamples?: number;
  droppedFunctionWindows?: number;
  durationMs: number;
  functions: null | ReportFunction[];
  mode: TraceRecording['mode'];
  sessionId: string;
  startedAt: string;
  status: TraceRecording['status'];
  title: string;
}
export interface ReportNamespace {
  calls: number;
  callSharePct: null | number;
  callsPerSecond: null | number;
  namespace: string;
  recordingPct: null | number;
  roots: null | number;
  rootsPerSecond: null | number;
  selfMs: null | number;
  selfMsPerSecond: null | number;
  selfSharePct: null | number;
}
export interface ReportSession extends ReportEvidence {
  calls: null | number;
  callsPerSecond: null | number;
  errors: null | number;
  namespaces: null | ReportNamespace[];
  roots: null | number;
  rootsPerSecond: null | number;
  seconds: number;
  selfMs: null | number;
  selfMsPerSecond: null | number;
}
export interface PerformanceReportData {
  calculationVersion: number;
  config: PerformanceReportConfig;
  sessions: Record<string, ReportSession>;
  warnings: string[];
}

export function reportFunctionKey(namespace: string, name: string): string {
  return `${namespace}\u0000${name}`;
}
export function safeRate(value: null | number, seconds: number): null | number {
  return value === null || seconds <= 0 ? null : value / seconds;
}
export function safeShare(value: number, total: number): null | number {
  return total > 0 ? (100 * value) / total : null;
}
export function baselineDelta(
  value: null | number,
  baseline: null | number,
): null | number {
  return value === null || baseline === null || baseline === 0
    ? null
    : (100 * (value - baseline)) / baseline;
}
export function durationBucket(duration: number): number {
  const index = DURATION_BUCKETS.findIndex((bound) => duration < bound);
  return index < 0 ? DURATION_BUCKETS.length : index;
}
export function percentile(values: number[], fraction: number): null | number {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
}
export function summarizeBrowserSamples(
  samples: { at: number; metric: string; unit: string; value: number }[],
): ReportBrowserMetric[] {
  const groups = new Map<
    string,
    { metric: string; unit: string; values: number[] }
  >();
  for (const sample of samples) {
    // The collector clamps pre-origin timestamps to zero. Excluding them avoids
    // treating an uncertain event position as a measured in-session sample.
    if (sample.at <= 0 || !Number.isFinite(sample.value)) {
      continue;
    }
    const item = groups.get(sample.metric) ?? {
      metric: sample.metric,
      unit: sample.unit,
      values: [],
    };
    item.values.push(sample.value);
    groups.set(sample.metric, item);
  }
  return [...groups.values()].map(({ metric, unit, values }) => {
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      count: values.length,
      max: values.length ? Math.max(...values) : null,
      mean: values.length ? total / values.length : null,
      metric,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      total,
      unit,
    };
  });
}

export function rankReportFunctions(
  functions: ReportFunction[],
  metric: 'calls' | 'inclusiveMs' | 'rootTreeCalls' | 'selfMs',
  mode: 'all' | 'root',
  namespace = 'all',
  limit = 8,
): ReportFunction[] {
  const value = (item: ReportFunction) =>
    mode === 'root'
      ? metric === 'calls'
        ? item.rootCalls
        : metric === 'inclusiveMs'
          ? item.rootInclusiveMs
          : metric === 'selfMs'
            ? item.rootSelfMs
            : item.rootTreeCalls
      : metric === 'rootTreeCalls'
        ? item.rootTreeCalls
        : item[metric];
  return functions
    .filter((item) => namespace === 'all' || item.namespace === namespace)
    .filter((item) => value(item) > 0)
    .sort((a, b) => value(b) - value(a) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function validateReportConfig(value: unknown): PerformanceReportConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('Report configuration must be an object.');
  }
  const config = value as PerformanceReportConfig;
  if (
    config.version !== 1 ||
    !Array.isArray(config.scenarios) ||
    !config.scenarios.length
  ) {
    throw new Error(
      'Expected a version 1 report configuration with scenarios.',
    );
  }
  const ids = new Set<string>();
  for (const scenario of config.scenarios) {
    validateScenario(scenario, ids);
    ids.add(scenario.id);
  }
  return config;
}

function validateScenario(scenario: ReportScenario, ids: Set<string>): void {
  if (
    !scenario.id ||
    !scenario.name ||
    ids.has(scenario.id) ||
    !Array.isArray(scenario.checkpoints) ||
    !scenario.checkpoints.length
  ) {
    throw new Error(
      'Each scenario needs a unique ID, name, and at least one checkpoint.',
    );
  }
  const checkpoints = scenario.checkpoints.map((item) => item.id);
  if (
    new Set(checkpoints).size !== checkpoints.length ||
    !checkpoints.includes(scenario.baselineCheckpointId)
  ) {
    throw new Error(
      `Scenario ${scenario.name} needs distinct checkpoints and an explicit baseline.`,
    );
  }
  if (!scenario.sessions || typeof scenario.sessions !== 'object') {
    throw new Error(`Scenario ${scenario.name} needs session assignments.`);
  }
}

export function createSingleSessionConfig(
  sessionId: string,
  title?: string,
): PerformanceReportConfig {
  return {
    scenarios: [
      {
        baselineCheckpointId: 'recording',
        checkpoints: [{ id: 'recording', name: 'Recording' }],
        id: 'session',
        name: 'Session',
        sessions: { recording: sessionId },
      },
    ],
    title,
    version: 1,
  };
}

export function buildPerformanceReport(
  configInput: PerformanceReportConfig,
  evidence: ReportEvidence[],
): PerformanceReportData {
  const config = validateReportConfig(configInput);
  const byId = new Map(evidence.map((item) => [item.sessionId, item]));
  const sessions: Record<string, ReportSession> = {};
  const warnings: string[] = [];
  for (const scenario of config.scenarios) {
    const modes = new Set<string>();
    for (const checkpoint of scenario.checkpoints) {
      const id = scenario.sessions[checkpoint.id];
      if (!id) {
        warnings.push(
          `${scenario.name} / ${checkpoint.name}: no recording assigned.`,
        );
        continue;
      }
      const item = byId.get(id);
      if (!item) {
        warnings.push(
          `${scenario.name} / ${checkpoint.name}: recording ${id} is unavailable.`,
        );
        continue;
      }
      sessions[id] ??= summarizeSession(item);
      modes.add(item.mode ?? 'full');
    }
    if (modes.size > 1) {
      warnings.push(
        `${scenario.name}: capture modes differ; compare only metrics recorded in both captures.`,
      );
    }
  }
  return {
    calculationVersion: REPORT_CALCULATION_VERSION,
    config,
    sessions,
    warnings,
  };
}

function summarizeSession(item: ReportEvidence): ReportSession {
  const seconds = item.durationMs / 1000;
  const rows = item.functions ?? item.aggregateFunctions;
  const calls = rows ? rows.reduce((sum, fn) => sum + fn.calls, 0) : null;
  const roots = item.functions
    ? item.functions.reduce((sum, fn) => sum + fn.rootCalls, 0)
    : null;
  const selfMs = item.functions
    ? item.functions.reduce((sum, fn) => sum + fn.selfMs, 0)
    : null;
  const errors = rows ? rows.reduce((sum, fn) => sum + fn.errors, 0) : null;
  return {
    ...item,
    calls,
    callsPerSecond: safeRate(calls, seconds),
    errors,
    namespaces: summarizeNamespaces(item, rows, calls, selfMs, seconds),
    roots,
    rootsPerSecond: safeRate(roots, seconds),
    seconds,
    selfMs,
    selfMsPerSecond: safeRate(selfMs, seconds),
  };
}

function summarizeNamespaces(
  item: ReportEvidence,
  rows: ReportEvidence['aggregateFunctions'] | ReportEvidence['functions'],
  calls: null | number,
  selfMs: null | number,
  seconds: number,
): null | ReportNamespace[] {
  if (!rows) {
    return null;
  }
  const grouped = new Map<
    string,
    { calls: number; roots: number; selfMs: number }
  >();
  for (const fn of rows) {
    const group = grouped.get(fn.namespace) ?? {
      calls: 0,
      roots: 0,
      selfMs: 0,
    };
    group.calls += fn.calls;
    group.roots +=
      'rootCalls' in fn && typeof fn.rootCalls === 'number' ? fn.rootCalls : 0;
    group.selfMs +=
      'selfMs' in fn && typeof fn.selfMs === 'number' ? fn.selfMs : 0;
    grouped.set(fn.namespace, group);
  }
  return [...grouped]
    .map(([namespace, value]) =>
      namespaceMetrics(item, namespace, value, calls, selfMs, seconds),
    )
    .sort((a, b) => b.calls - a.calls);
}

function namespaceMetrics(
  item: ReportEvidence,
  namespace: string,
  value: { calls: number; roots: number; selfMs: number },
  calls: null | number,
  selfMs: null | number,
  seconds: number,
): ReportNamespace {
  const full = Boolean(item.functions);
  return {
    calls: value.calls,
    callSharePct: safeShare(value.calls, calls ?? 0),
    callsPerSecond: safeRate(value.calls, seconds),
    namespace,
    recordingPct:
      full && item.durationMs > 0
        ? (100 * value.selfMs) / item.durationMs
        : null,
    roots: full ? value.roots : null,
    rootsPerSecond: full ? safeRate(value.roots, seconds) : null,
    selfMs: full ? value.selfMs : null,
    selfMsPerSecond: full ? safeRate(value.selfMs, seconds) : null,
    selfSharePct: full ? safeShare(value.selfMs, selfMs ?? 0) : null,
  };
}
