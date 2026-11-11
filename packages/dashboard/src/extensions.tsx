import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
} from 'react';

import type { CoreAnalysis } from './coreAnalysis';
import type { DashboardNavigation } from './navigation';
import type { BrowserSummary, FrameQuery, SessionClient } from './sessionData';
import type { TraceEvent, TraceRecording } from './types';

export type BuiltinPageId = 'frames' | 'functions' | 'overview' | 'problems';
export type DashboardBlockId =
  | 'frames.inspector'
  | 'functions.table'
  | 'overview.browser-signals'
  | 'overview.metrics'
  | 'overview.timeline';

export interface DashboardContextValue {
  analysis: CoreAnalysis;
  browserSummary?: BrowserSummary;
  dataScope: 'complete' | 'summary';
  inspectFrames?: (filters: Partial<FrameQuery>) => void;
  /** Explicit opt-in for extensions needing the complete payload. */
  loadRecording?: (signal?: AbortSignal) => Promise<TraceRecording>;
  navigate: (page: string) => void;
  navigation?: DashboardNavigation;
  page: string;
  query: string;
  recording: TraceRecording;
  root: string;
  selectedFrame?: TraceEvent;
  selectedFunction?: string;
  selectedRay?: string;
  selectedTimeBucket: number;
  selectFrame: (id: number) => void;
  selectFunction?: (id: string) => void;
  selectRay: (ray: string) => void;
  selectTimeBucket: (bucket: number) => void;
  /** Summary mode exposes metadata only; use analysis for totals. */
  sessionClient?: SessionClient;
  setQuery: (query: string) => void;
  setRoot: (root: string) => void;
  traceDataExcluded?: boolean;
}

export interface ReplacementProps {
  children: ReactNode;
}
export interface DashboardPageDefinition {
  component: ComponentType;
  id: string;
  label: string;
  subtitle: string;
}
export interface OverviewBlockDefinition {
  component: ComponentType;
  id: string;
}
export interface DashboardCustomization {
  additionalPages?: DashboardPageDefinition[];
  blocks?: Partial<
    Record<DashboardBlockId, ComponentType<ReplacementProps> | false>
  >;
  overviewBlocks?: OverviewBlockDefinition[];
  pages?: Partial<
    Record<BuiltinPageId, ComponentType<ReplacementProps> | false>
  >;
}
const Context = createContext<DashboardContextValue | null>(null);
const Customization = createContext<DashboardCustomization>({});
export const DashboardContextProvider = Context.Provider;
export const DashboardCustomizationProvider = Customization.Provider;

export function useDashboard(): DashboardContextValue {
  const value = useContext(Context);
  if (!value) {
    throw new Error('useDashboard requires a CoreRecordingDashboard ancestor');
  }
  return value;
}

export function DashboardBlock({
  children,
  id,
}: {
  children: ReactNode;
  id: DashboardBlockId;
}) {
  const Replacement = useContext(Customization).blocks?.[id];
  if (Replacement === false) {
    return null;
  }
  return Replacement ? <Replacement>{children}</Replacement> : <>{children}</>;
}

export function DashboardPage({
  children,
  id,
}: {
  children: ReactNode;
  id: BuiltinPageId;
}) {
  const Replacement = useContext(Customization).pages?.[id];
  if (Replacement === false) {
    return null;
  }
  return Replacement ? <Replacement>{children}</Replacement> : <>{children}</>;
}

export function validateCustomization(
  customization: DashboardCustomization,
  columns: readonly { id: string }[] = [],
) {
  validateIds(
    customization.additionalPages ?? [],
    new Set(['frames', 'functions', 'overview', 'problems']),
    'dashboard page',
  );
  validateIds(customization.overviewBlocks ?? [], new Set(), 'overview block');
  validateIds(columns, new Set(), 'function column');
}

function validateIds(
  items: readonly { id: string }[],
  ids: Set<string>,
  kind: string,
) {
  for (const item of items) {
    if (!item.id || ids.has(item.id)) {
      throw new Error(`Duplicate or empty ${kind} ID: ${item.id}`);
    }
    ids.add(item.id);
  }
}
