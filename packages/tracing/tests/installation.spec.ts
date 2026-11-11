// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'location');
const RUNTIME_OWNER = Symbol.for('@sx/tracing/runtime/v2');
const TRANSPORT_OWNER = Symbol.for('@sx/tracing/transport/v2');

function setSearch(search: string) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { search },
  });
}

// The first copy to load claims the shared owner and caches the answer there.
// resetModules alone would hand the next import that same owner.
async function freshTracing() {
  Reflect.deleteProperty(globalThis, RUNTIME_OWNER);
  Reflect.deleteProperty(globalThis, TRANSPORT_OWNER);
  Reflect.deleteProperty(globalThis, '__EDITOR_TRACING__');
  vi.resetModules();
  return import('../src');
}

afterEach(() => {
  if (ORIGINAL) {
    Object.defineProperty(globalThis, 'location', ORIGINAL);
  } else {
    Reflect.deleteProperty(globalThis, 'location');
  }
  vi.resetModules();
});

describe('installation gate', () => {
  it('wraps nothing when the page did not ask for tracing', async () => {
    setSearch('?metaSiteId=abc');
    const tracing = await freshTracing();

    const original = () => 42;
    expect(tracing.trace(original, 'Thing.run')).toBe(original);

    class Service {
      run() {
        return 'ran';
      }
    }
    expect(tracing.Trace(Service)).toBe(Service);
    expect(Service.prototype.run.name).toBe('run');

    const service = { method: () => 'value' };
    expect(tracing.wrapTraceService(service, 'Service')).toBe(service);
    expect(service.method.name).not.toContain('Service');
  });

  it('refuses a capture that could not contain any calls', async () => {
    setSearch('?metaSiteId=abc');
    const tracing = await freshTracing();

    expect(() => tracing.startRecording({ cpu: false })).toThrow(
      /install-tracing/,
    );
  });

  it('still allows browser mode, which never needed wrappers', async () => {
    setSearch('?metaSiteId=abc');
    const tracing = await freshTracing();

    expect(() =>
      tracing.startRecording({ cpu: false, mode: 'browser' }),
    ).not.toThrow();
    expect(tracing.releaseRecording().mode).toBe('browser');
  });

  it('wraps once the page asks for it', async () => {
    setSearch('?metaSiteId=abc&install-tracing');
    const tracing = await freshTracing();

    const original = () => 42;
    const traced = tracing.trace(original, 'Thing.run');
    expect(traced).not.toBe(original);

    tracing.startRecording({ cpu: false });
    expect(traced()).toBe(42);
    const recording = tracing.releaseRecording();
    expect(
      recording.traces.flatMap(({ events }) => events.map(({ name }) => name)),
    ).toContain('Thing.run');
  });

  it('treats a server with no location as not installed', async () => {
    Reflect.deleteProperty(globalThis, 'location');
    const tracing = await freshTracing();

    const original = () => 42;
    expect(tracing.trace(original, 'Thing.run')).toBe(original);
    expect(() => tracing.startRecording()).toThrow(/install-tracing/);
  });

  it('gates every trace entry point, not only the wrappers', async () => {
    setSearch('?metaSiteId=abc');
    const tracing = await freshTracing();

    // withTrace and traceStep call the recorder directly rather than through a
    // wrapper, so they need the same gate.
    expect(tracing.withTrace('Thing.operation', () => 'value')).toBe('value');
    expect(tracing.traceStep('Thing.step', () => 'step')).toBe('step');
    expect(
      tracing.getGlobalTracing().run('ns', 'Thing.run', () => 7, null, []),
    ).toBe(7);
    expect(tracing.getRecordingState().isRecording).toBe(false);
  });
});
