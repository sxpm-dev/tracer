import { useEffect, useState } from 'react';

export interface DashboardViewState {
  breadcrumbs?: string;
  bucket?: number;
  frame?: number;
  frameOffset?: number;
  frameQuery?: string;
  frameRay?: string;
  from?: number;
  functionId?: string;
  kind?: string;
  maxDuration?: number;
  minDuration?: number;
  name?: string;
  namespace?: string;
  page: string;
  parent?: number;
  query?: string;
  ray?: string;
  rayOffset?: number;
  rayQuery?: string;
  root?: string;
  rootsOnly?: string;
  sort?: string;
  to?: number;
  tree?: string;
}
export interface DashboardNavigation {
  href?: (view: DashboardViewState) => string;
  onChange: (view: DashboardViewState, replace?: boolean) => void;
  state: DashboardViewState;
}
export interface DashboardRoute {
  kind: 'home' | 'local' | 'missing' | 'report' | 'sample' | 'session';
  sessionId?: string;
  sessionIds?: string[];
  view: DashboardViewState;
}
const strings = [
  'breadcrumbs',
  'rootsOnly',
  'tree',
  'functionId',
  'query',
  'root',
  'ray',
  'frameQuery',
  'rayQuery',
  'frameRay',
  'kind',
  'sort',
  'namespace',
  'name',
] as const;
const numbers = [
  'bucket',
  'frame',
  'frameOffset',
  'rayOffset',
  'maxDuration',
  'minDuration',
  'from',
  'to',
  'parent',
] as const;
function validNumber(key: string, value: number) {
  const fractional = ['from', 'minDuration', 'to'].includes(key);
  return (
    value >= 0 &&
    (fractional ? Number.isFinite(value) : Number.isSafeInteger(value))
  );
}
function parseView(params: URLSearchParams) {
  const view: DashboardViewState = { page: 'overview' };
  for (const key of strings) {
    view[key] = params.get(key) || undefined;
  }
  for (const key of numbers) {
    const raw = params.get(key);
    const number = Number(raw);
    if (raw !== null && validNumber(key, number)) {
      view[key] = number;
    }
  }
  return view;
}
export function parseDashboardRoute(value: string): DashboardRoute {
  const url = new URL(value, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const view = parseView(url.searchParams);
  if (!parts.length) {
    return { kind: 'home', view };
  }
  if (parts[0] === 'reports' && parts.length === 1) {
    return parseReportRoute(url, view);
  }
  if (isLocalPath(parts)) {
    return { kind: 'local', view: { ...view, page: parts[1] || 'overview' } };
  }
  if (isSamplePath(parts)) {
    return {
      kind: 'sample',
      sessionId: parts[1],
      view: { ...view, page: parts[2] || 'overview' },
    };
  }
  if (isSessionPath(parts)) {
    return {
      kind: 'session',
      sessionId: parts[1],
      view: { ...view, page: parts[2] || 'overview' },
    };
  }
  return { kind: 'missing', view };
}
function parseReportRoute(url: URL, view: DashboardViewState): DashboardRoute {
  const sessionIds = url.searchParams.getAll('session').filter(Boolean);
  return sessionIds.length
    ? { kind: 'report', sessionIds, view: { page: 'overview' } }
    : { kind: 'missing', view };
}
export function dashboardRouteUrl(route: DashboardRoute) {
  const special = specialRouteUrl(route);
  if (special) {
    return special;
  }
  const path =
    route.kind === 'local'
      ? '/local'
      : `/${route.kind === 'sample' ? 'sample' : 'sessions'}/${encodeURIComponent(route.sessionId ?? '')}`;
  const params = new URLSearchParams();
  for (const key of [...strings, ...numbers]) {
    const value = route.view[key];
    if (value !== undefined && value !== '') {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return `${path}/${encodeURIComponent(route.view.page)}${query ? `?${query}` : ''}`;
}
function specialRouteUrl(route: DashboardRoute): null | string {
  if (route.kind === 'home') {
    return '/';
  }
  if (route.kind !== 'report') {
    return null;
  }
  const params = new URLSearchParams();
  route.sessionIds?.forEach((id) => params.append('session', id));
  return `/reports?${params.toString()}`;
}
function initialRoute(local: boolean, hashRouting: boolean): DashboardRoute {
  const route = readLocation(hashRouting);
  return local && route.kind !== 'local'
    ? { kind: 'local', view: { page: 'overview' } }
    : route;
}
function readLocation(hashRouting: boolean): DashboardRoute {
  if (typeof window === 'undefined') {
    return { kind: 'home', view: { page: 'overview' } } as DashboardRoute;
  }
  try {
    return parseDashboardRoute(
      hashRouting
        ? window.location.hash.slice(1) || '/'
        : `${window.location.pathname}${window.location.search}`,
    );
  } catch {
    return { kind: 'missing', view: { page: 'overview' } } as DashboardRoute;
  }
}

export function useDashboardRoute(local = false) {
  const hashRouting =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' ||
      Boolean(document.querySelector('#trace-data, #dashboard-snapshot')));
  const [route, setRoute] = useState<DashboardRoute>(() =>
    initialRoute(local, hashRouting),
  );
  const href = (next: DashboardRoute) =>
    `${hashRouting ? '#' : ''}${dashboardRouteUrl(next)}`;
  const navigate = (next: DashboardRoute, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState'](
      null,
      '',
      href(next),
    );
    setRoute(next);
  };
  useEffect(() => {
    if (local && readLocation(hashRouting).kind !== 'local') {
      window.history.replaceState(
        null,
        '',
        `${hashRouting ? '#' : ''}/local/overview`,
      );
    }
  }, [hashRouting, local]);
  useEffect(() => {
    const update = () => setRoute(readLocation(hashRouting));
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, [hashRouting]);
  return { href, navigate, route };
}

function isSamplePath(parts: string[]) {
  return (
    parts[0] === 'sample' &&
    ['full', 'light'].includes(parts[1]) &&
    parts.length <= 3
  );
}

function isLocalPath(parts: string[]) {
  return parts[0] === 'local' && parts.length <= 2;
}

function isSessionPath(parts: string[]) {
  return parts[0] === 'sessions' && Boolean(parts[1]) && parts.length <= 3;
}
