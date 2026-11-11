import { configure } from '@testing-library/react';
import { TextDecoder, TextEncoder } from 'util';
import { vi } from 'vitest';

configure({ testIdAttribute: 'data-hook' });
vi.setConfig({ testTimeout: 10000 });

Object.assign(global, { TextDecoder, TextEncoder });

// Mock ResizeObserver for tests
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = ResizeObserverMock;

class IntersectionObserverMock {
  root: Element | null = null;
  rootMargin: string = '0px';
  thresholds: number[] = [0];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

global.IntersectionObserver = IntersectionObserverMock;

// Tracing only installs its wrappers when the page asks for it. Tests exercise
// the installed behaviour, so ask before any module reads the answer; the
// recorder and the DI container both cache it on first use. Suites that run in
// the node environment have no location, which production treats as "not a
// browser, do not install"; they get a stub so they can test the recorder.
if (typeof globalThis.location === 'undefined') {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search: '?install-tracing' },
  });
} else {
  globalThis.history.replaceState({}, '', '?install-tracing');
}
