import type { CallPath } from './callPaths';
import type { CoreAnalysis } from './coreAnalysis';
import type { ReportEvidence } from './performanceReport';
import type {
  TraceBrowserSample,
  TraceEvent,
  TraceExtensionSample,
  TraceRecording,
} from './types';

import { fetchSnapshot } from './snapshotTransport';

export interface BrowserSeries {
  count: number;
  counts: number[];
  metric: string;
  points: number[];
  unit: TraceBrowserSample['unit'];
}
export type SliceFunctions = [string, { calls: number; duration: number }][];
export interface BrowserSummary {
  functions: SliceFunctions[];
  series: BrowserSeries[];
}
/** Metadata only: traces and sample arrays are deliberately absent/empty. */
export interface SessionSummary {
  analysis: CoreAnalysis;
  browser: BrowserSummary;
  recording: TraceRecording;
  traceDataExcluded?: boolean;
}
export interface ResultPage<T> {
  items: T[];
  offset: number;
  total: number;
}
export interface FrameItem extends TraceEvent {
  ancestors?: { id: number; name: string }[];
  childCount?: number;
  depth?: number;
}
export interface FramePage extends ResultPage<FrameItem> {
  metadata?: Record<string, unknown>;
  selected?: TraceEvent;
}
export interface PreparationProgress {
  bytes: number;
  phase: string;
  totalBytes: number;
}
export interface CallAnalytics {
  bucketMs: number;
  chartCounts: number[];
  chartRootCounts: number[];
  counts: number[];
  functions: CoreAnalysis['functions'];
  rootTotal: number;
  total: number;
}
export interface FrameQuery {
  frame?: number;
  frameRay?: string;
  from?: number;
  functionLimit?: number;
  kind?: string;
  maxDuration?: number;
  minDuration?: number;
  name?: string;
  namespace?: string;
  offset?: number;
  parent?: number;
  query?: string;
  ray?: string;
  root?: string;
  rootsOnly?: boolean;
  sort?: string;
  subtree?: number;
  to?: number;
}
export const SESSION_PAGE_SIZE = 100;

/** Read-only, page-scoped API; requests can be cancelled on navigation. */
export function createSessionClient(serverUrl = '') {
  const base = `${serverUrl.replace(/\/$/, '')}/api/recordings`;
  async function get<T>(
    id: string,
    path: string,
    query: URLSearchParams,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(
      `${base}/${encodeURIComponent(id)}/${path}?${query}`,
      { signal },
    );
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? 'This session is no longer available.'
          : `Could not load session data (${response.status}).`,
      );
    }
    return response.json() as Promise<T>;
  }
  return {
    analytics(id: string, query: FrameQuery, signal?: AbortSignal) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.set(key === 'query' ? 'q' : key, String(value));
        }
      }
      return get<CallAnalytics>(id, 'analytics', params, signal);
    },
    callPaths(id: string, query: FrameQuery, signal?: AbortSignal) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          params.set(key === 'query' ? 'q' : key, String(value));
        }
      }
      return get<CallPath[]>(id, 'call-paths', params, signal);
    },
    exportSnapshot(
      id: string,
      signal?: AbortSignal,
      onProgress?: (progress: number) => void,
    ) {
      return fetchSnapshot(
        `${base}/${encodeURIComponent(id)}/export`,
        signal,
        onProgress,
      );
    },
    frames(id: string, query: FrameQuery, signal?: AbortSignal) {
      const params = new URLSearchParams({
        offset: String(query.offset ?? 0),
        q: query.query ?? '',
        ray: query.ray ?? '',
      });
      for (const key of [
        'rootsOnly',
        'subtree',
        'maxDuration',
        'frameRay',
        'kind',
        'sort',
        'namespace',
        'name',
        'minDuration',
        'from',
        'to',
        'parent',
        'root',
      ] as const) {
        if (query[key] !== undefined) {
          params.set(key, String(query[key]));
        }
      }
      if (query.frame !== undefined) {
        params.set('frame', String(query.frame));
      }
      return get<FramePage>(id, 'frames', params, signal);
    },
    progress(id: string, signal?: AbortSignal) {
      return get<PreparationProgress>(
        id,
        'progress',
        new URLSearchParams(),
        signal,
      );
    },
    rays(id: string, offset = 0, query = '', signal?: AbortSignal) {
      return get<ResultPage<CoreAnalysis['rays'][number]>>(
        id,
        'rays',
        new URLSearchParams({ offset: String(offset), q: query }),
        signal,
      );
    },
    reportEvidence(
      id: string,
      signal?: AbortSignal,
      onProgress?: (progress: number) => void,
    ): Promise<ReportEvidence> {
      return fetchSnapshot<ReportEvidence>(
        `${base}/${encodeURIComponent(id)}/report-evidence`,
        signal,
        onProgress,
      );
    },
    samples(id: string, channel: string, offset = 0, signal?: AbortSignal) {
      return get<ResultPage<TraceExtensionSample>>(
        id,
        'extensions',
        new URLSearchParams({ channel, offset: String(offset) }),
        signal,
      );
    },
    summary(id: string, root = '', signal?: AbortSignal) {
      return get<SessionSummary>(
        id,
        'summary',
        new URLSearchParams({ root }),
        signal,
      );
    },
  };
}
export type SessionClient = Omit<
  ReturnType<typeof createSessionClient>,
  'exportSnapshot' | 'reportEvidence'
> &
  Partial<
    Pick<
      ReturnType<typeof createSessionClient>,
      'exportSnapshot' | 'reportEvidence'
    >
  >;
