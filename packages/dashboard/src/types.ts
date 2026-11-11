import type {
  TraceCaptureCapability,
  TraceCpuSource,
  TraceEvent,
} from '@sx/recordings';

export type * from '@sx/recordings';
export interface LocalRecordingSummary {
  aggregateCallCount?: number;
  browserCapabilities?: TraceCaptureCapability[];
  browserSampleCount?: number;
  bytes: number;
  cpuSampleCount?: number;
  cpuSource?: TraceCpuSource;
  dataStartedAt?: string;
  droppedBrowserSamples?: number;
  droppedFunctionWindows?: number;
  duration?: number;
  eventCount: number;
  functionWindowCount?: number;
  mode?: 'browser' | 'full' | 'light';
  releasedAt?: string;
  sessionId: string;
  startedAt: string;
  status: 'complete' | 'recording';
  timelineOrigin?: number;
  title: string;
  traceCount: number;
  updatedAt: string;
}

export interface EventRow extends TraceEvent {
  childCount: number;
  depth: number;
  relativeAt: number;
}
