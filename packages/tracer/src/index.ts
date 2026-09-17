export type TraceEventKind = "call" | "marker";

export interface TraceEvent<TData = unknown> {
  id: number;
  ray: string;
  name: string;
  kind: TraceEventKind;
  data?: TData;
  parent?: number;
  args?: unknown;
  result?: unknown;
  error?: unknown;
  status?: "ok" | "error";
  duration?: number;
  at: number;
  stack?: string;
}

export interface TraceOptions {
  name?: string;
  captureStack?: boolean;
  captureTiming?: boolean;
  captureArgs?: boolean | ((args: unknown[]) => unknown);
  captureResult?: boolean | ((result: unknown) => unknown);
  captureError?: boolean | ((error: unknown) => unknown);
}

export type TracedFunction<T extends (...args: any[]) => any> = T & {
  readonly ray: string | undefined;
};

type AnyFunction = (...args: any[]) => any;

interface EventExtras {
  args?: unknown;
  data?: unknown;
  status?: "ok" | "error";
  duration?: number;
  result?: unknown;
  error?: unknown;
  stackHolder?: Error;
}

interface TraceHeap {
  ray: string;
  names: string[];
  kinds: number[];
  parents: number[];
  ats: number[];
  extras: Map<number, EventExtras> | undefined;
  stackHolder?: Error;
}

const KIND_CALL = 0;
const KIND_MARKER = 1;
const MAX_HEAPS = 1024;

interface UnresolvedMarker<TData = unknown> {
  name: string;
  data?: TData;
  at: number;
  segment: UnresolvedSegment;
  candidates: TraceHeap[];
  resolved: boolean;
}

interface UnresolvedSegment {
  error: Error;
  candidates: TraceHeap[];
}

const FRAME_PREFIX = "__sx_trace__";
const FRAME_RE = /__sx_trace__(\d+)/;
const heaps = new Map<string, TraceHeap>();
const subscribers: Array<(event: TraceEvent) => void> = [];
let currentScope: TraceHeap | undefined;

let activeDepth = 0;
const activeHeaps: TraceHeap[] = [];
const activeNames: string[] = [];
const activeEventIds: (number | undefined)[] = [];
const activeStackHolders: (Error | undefined)[] = [];

const unresolvedMarkers: UnresolvedMarker[] = [];
let unresolvedSegment: UnresolvedSegment | undefined;
const pendingAsyncHeaps = new Map<TraceHeap, number>();
let latestHeap: TraceHeap | undefined;
let nextRay = 0;

function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function createRay(): string {
  nextRay += 1;
  return `${Date.now().toString(36)}-${nextRay.toString(36)}`;
}

function stack(): string | undefined {
  return new Error().stack;
}

function frameFromStack(value = stack()): { ray: string; name: string } | undefined {
  const match = value?.match(FRAME_RE);
  if (!match) {
    return undefined;
  }

  const info = asyncSlotInfo.get(Number.parseInt(match[1], 10));
  if (!info) {
    return undefined;
  }

  return { ray: info.heap.ray, name: info.name };
}

function rayFromStack(value = stack()): string | undefined {
  return frameFromStack(value)?.ray;
}

function heapFromTarget(target?: string | { ray?: string }): TraceHeap | undefined {
  if (typeof target === "string") {
    return heaps.get(target);
  }

  return target?.ray ? heaps.get(target.ray) : latestHeap;
}

function createHeap(ray = createRay(), stackHolder?: Error): TraceHeap {
  let heap = heaps.get(ray);
  if (!heap) {
    if (heaps.size >= MAX_HEAPS) {
      const oldestRay = heaps.keys().next().value;
      if (oldestRay !== undefined) {
        const oldest = heaps.get(oldestRay);
        heaps.delete(oldestRay);
        if (oldest) {
          releaseSlotsForHeap(oldest);
          if (latestHeap === oldest) {
            latestHeap = undefined;
          }
        }
      }
    }
    heap = {
      ray,
      names: [],
      kinds: [],
      parents: [],
      ats: [],
      extras: undefined,
      stackHolder,
    };
    heaps.set(ray, heap);
  } else if (stackHolder && !heap.stackHolder) {
    heap.stackHolder = stackHolder;
  }

  latestHeap = heap;
  return heap;
}

function pushRecord(
  heap: TraceHeap,
  name: string,
  kind: number,
  parent: number,
  at: number,
  args: unknown,
  data: unknown,
): number {
  const id = heap.names.length + 1;
  heap.names.push(name);
  heap.kinds.push(kind);
  heap.parents.push(parent);
  heap.ats.push(at);
  if (args !== undefined || data !== undefined) {
    let extras = heap.extras;
    if (!extras) {
      extras = new Map();
      heap.extras = extras;
    }
    extras.set(id, { args, data });
  }
  if (subscribers.length > 0) {
    const event = synthesizeEvent(heap, id - 1);
    for (let i = 0; i < subscribers.length; i += 1) {
      subscribers[i]!(event);
    }
  }
  return id;
}

function subscribe(callback: (event: TraceEvent) => void): () => void {
  subscribers.push(callback);
  return () => {
    const index = subscribers.indexOf(callback);
    if (index >= 0) {
      subscribers.splice(index, 1);
    }
  };
}

function ensureExtras(heap: TraceHeap, id: number): EventExtras {
  let extras = heap.extras;
  if (!extras) {
    extras = new Map();
    heap.extras = extras;
  }
  let entry = extras.get(id);
  if (!entry) {
    entry = {};
    extras.set(id, entry);
  }
  return entry;
}

function synthesizeEvent(heap: TraceHeap, index: number): TraceEvent {
  const id = index + 1;
  const ex = heap.extras?.get(id);
  const event: TraceEvent = {
    id,
    ray: heap.ray,
    name: heap.names[index]!,
    kind: heap.kinds[index] === KIND_CALL ? "call" : "marker",
    at: heap.ats[index]!,
    parent: heap.parents[index] || undefined,
    args: ex?.args,
    data: ex?.data,
    status: ex?.status,
    duration: ex?.duration,
    result: ex?.result,
    error: ex?.error,
  };
  if (ex?.stackHolder) {
    const holder = ex.stackHolder;
    let captured: string | undefined;
    Object.defineProperty(event, "stack", {
      configurable: true,
      enumerable: true,
      get() {
        captured ??= holder.stack;
        return captured;
      },
    });
  }
  return event;
}

function pushActiveFrame(heap: TraceHeap, name: string, eventId: number | undefined, holder: Error | undefined): void {
  const i = activeDepth;
  activeHeaps[i] = heap;
  activeNames[i] = name;
  activeEventIds[i] = eventId;
  activeStackHolders[i] = holder;
  activeDepth = i + 1;
}

function popActiveFrame(): void {
  activeDepth -= 1;
}

function activeStackHolder(): Error | undefined {
  for (let i = activeDepth - 1; i >= 0; i -= 1) {
    const holder = activeStackHolders[i];
    if (holder) {
      return holder;
    }
  }

  return undefined;
}

function captureArgs(options: TraceOptions, args: unknown[]): unknown {
  if (typeof options.captureArgs === "function") {
    return options.captureArgs(args);
  }

  return options.captureArgs ? [...args] : undefined;
}

function captureResult(options: TraceOptions, result: unknown): unknown {
  if (typeof options.captureResult === "function") {
    return options.captureResult(result);
  }

  return options.captureResult ? result : undefined;
}

function captureError(options: TraceOptions, error: unknown): unknown {
  if (typeof options.captureError === "function") {
    return options.captureError(error);
  }

  return options.captureError ? error : undefined;
}

function finishCall(
  heap: TraceHeap,
  id: number,
  callAt: number,
  options: TraceOptions,
  status: "ok" | "error",
  value: unknown,
): void {
  const extras = ensureExtras(heap, id);
  extras.status = status;
  if (options.captureTiming) {
    extras.duration = now() - callAt;
  }

  if (status === "ok") {
    const result = captureResult(options, value);
    if (result !== undefined) {
      extras.result = result;
    }
    return;
  }

  const error = captureError(options, value);
  if (error !== undefined) {
    extras.error = error;
  }
}

function shouldFinish(options: TraceOptions, status: "ok" | "error"): boolean {
  if (status === "error") {
    return true;
  }
  return Boolean(options.captureTiming || options.captureResult);
}

type AsyncSlot = <T>(value: PromiseLike<T>, slot: number, heap: TraceHeap) => Promise<T>;

const ASYNC_POOL_INITIAL = 64;
const asyncPool: AsyncSlot[] = [];
const asyncSlotInfo = new Map<number, { heap: TraceHeap; name: string }>();
const slotsInFlight = new Set<number>();
let asyncSlotCursor = 0;

function buildAsyncSlot(slot: number): AsyncSlot {
  const frameName = `${FRAME_PREFIX}${slot}`;
  const holder = {
    async [frameName]<T>(value: PromiseLike<T>, slotId: number, heap: TraceHeap): Promise<T> {
      try {
        return await value;
      } finally {
        slotsInFlight.delete(slotId);
        const count = (pendingAsyncHeaps.get(heap) ?? 1) - 1;
        if (count > 0) {
          pendingAsyncHeaps.set(heap, count);
        } else {
          pendingAsyncHeaps.delete(heap);
        }
      }
    },
  };
  return holder[frameName] as AsyncSlot;
}

for (let i = 0; i < ASYNC_POOL_INITIAL; i += 1) {
  asyncPool.push(buildAsyncSlot(i));
}

function takeAsyncSlot(heap: TraceHeap, name: string): number {
  for (let attempt = 0; attempt < asyncPool.length; attempt += 1) {
    const slot = asyncSlotCursor;
    asyncSlotCursor = (asyncSlotCursor + 1) % asyncPool.length;
    if (!slotsInFlight.has(slot) && !asyncSlotInfo.has(slot)) {
      slotsInFlight.add(slot);
      asyncSlotInfo.set(slot, { heap, name });
      return slot;
    }
  }

  const slot = asyncPool.length;
  asyncPool.push(buildAsyncSlot(slot));
  slotsInFlight.add(slot);
  asyncSlotInfo.set(slot, { heap, name });
  return slot;
}

function releaseSlotsForHeap(heap: TraceHeap): void {
  for (const [slot, info] of asyncSlotInfo) {
    if (info.heap === heap) {
      asyncSlotInfo.delete(slot);
    }
  }
}

function keepAsyncStackFrame<T>(name: string, heap: TraceHeap, value: T): T {
  if (!value || typeof (value as unknown as Promise<unknown>).then !== "function") {
    return value;
  }

  pendingAsyncHeaps.set(heap, (pendingAsyncHeaps.get(heap) ?? 0) + 1);
  const slot = takeAsyncSlot(heap, name);
  return asyncPool[slot]!(value as unknown as PromiseLike<Awaited<T>>, slot, heap) as T;
}

function wrap<T extends AnyFunction>(fn: T, options: TraceOptions = {}): TracedFunction<T> {
  let lastRay: string | undefined;
  const name = options.name ?? fn.name ?? "anonymous";

  function traced(this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    const parentI = activeDepth - 1;
    if (
      parentI < 0 &&
      currentScope === undefined &&
      pendingAsyncHeaps.size === 0 &&
      subscribers.length === 0 &&
      !options.captureStack
    ) {
      return fn.apply(this, args);
    }

    const parentHeap = parentI >= 0 ? activeHeaps[parentI] : undefined;
    const parentEventId = parentI >= 0 ? activeEventIds[parentI] : undefined;
    const parentStackHolder = parentI >= 0 ? activeStackHolders[parentI] : undefined;
    const stackHolder = parentStackHolder ?? (options.captureStack ? activeStackHolder() : undefined);
    const ray = parentHeap?.ray ?? (pendingAsyncHeaps.size > 0 ? rayFromStack() : undefined);
    const needsSegmentHolder = options.captureStack && !stackHolder;
    const nextStackHolder = stackHolder ?? (needsSegmentHolder ? new Error() : undefined);
    const heap =
      parentHeap ?? currentScope ?? (ray ? heaps.get(ray) : undefined) ?? createHeap(ray, nextStackHolder);
    if (nextStackHolder && !heap.stackHolder) {
      heap.stackHolder = nextStackHolder;
    }

    latestHeap = heap;
    lastRay = heap.ray;
    const callAt = now();
    const callId = pushRecord(
      heap,
      name,
      KIND_CALL,
      parentEventId ?? 0,
      callAt,
      captureArgs(options, args),
      undefined,
    );
    if (options.captureStack) {
      ensureExtras(heap, callId).stackHolder = nextStackHolder;
    }

    pushActiveFrame(heap, name, callId, nextStackHolder);
    let result: ReturnType<T>;
    try {
      result = keepAsyncStackFrame(name, heap, fn.apply(this, args)) as ReturnType<T>;
    } catch (error) {
      popActiveFrame();
      finishCall(heap, callId, callAt, options, "error", error);
      throw error;
    }
    popActiveFrame();

    if (result && typeof (result as unknown as Promise<unknown>).then === "function") {
      return (result as unknown as Promise<unknown>).then(
        (resolved) => {
          if (shouldFinish(options, "ok")) {
            finishCall(heap, callId, callAt, options, "ok", resolved);
          }
          return resolved;
        },
        (rejected) => {
          finishCall(heap, callId, callAt, options, "error", rejected);
          throw rejected;
        },
      ) as ReturnType<T>;
    }

    if (shouldFinish(options, "ok")) {
      finishCall(heap, callId, callAt, options, "ok", result);
    }
    return result;
  }

  Object.defineProperty(traced, "name", {
    configurable: true,
    value: name,
  });
  Object.defineProperty(traced, "ray", {
    configurable: true,
    get: () => lastRay,
  });

  return traced as TracedFunction<T>;
}

function marker<TData = unknown>(name: string, data?: TData): void {
  const i = activeDepth - 1;
  if (i >= 0) {
    const heap = activeHeaps[i]!;
    pushRecord(
      heap,
      `${activeNames[i]}.${name}`,
      KIND_MARKER,
      activeEventIds[i] ?? 0,
      now(),
      undefined,
      data,
    );
    return;
  }

  if (pendingAsyncHeaps.size <= 0) {
    return undefined;
  }

  unresolvedMarkers.push({
    name,
    data,
    at: now(),
    segment: unresolvedSegment
      ? unresolvedSegment
      : (unresolvedSegment = {
          error: new Error(),
          candidates: [...pendingAsyncHeaps.keys()],
        }),
    candidates: unresolvedSegment.candidates,
    resolved: false,
  });
  queueMicrotask(() => {
    unresolvedSegment = undefined;
  });
  return undefined;
}

function step<T>(name: string, fn: () => T): T extends Promise<infer R> ? Promise<R> : T {
  const parentI = activeDepth - 1;
  if (parentI < 0) {
    return fn() as ReturnType<typeof step<T>>;
  }

  const parentHeap = activeHeaps[parentI]!;
  pushActiveFrame(parentHeap, name, undefined, activeStackHolders[parentI]);
  try {
    return keepAsyncStackFrame(name, parentHeap, fn()) as ReturnType<typeof step<T>>;
  } finally {
    popActiveFrame();
  }
}

function resolveUnresolvedMarkers(): void {
  for (const marker of unresolvedMarkers) {
    if (marker.resolved) {
      continue;
    }

    const frame = frameFromStack(marker.segment.error.stack);
    const heap = frame ? heaps.get(frame.ray) : undefined;
    if (!frame || !heap || !marker.candidates.includes(heap)) {
      continue;
    }

    pushRecord(heap, `${frame.name}.${marker.name}`, KIND_MARKER, 0, marker.at, undefined, marker.data);
    marker.resolved = true;
  }
}

function compactUnresolvedMarkers(): void {
  let write = 0;
  for (const marker of unresolvedMarkers) {
    if (!marker.resolved) {
      unresolvedMarkers[write] = marker;
      write += 1;
    }
  }

  unresolvedMarkers.length = write;
}

function synthesizeEvents(heap: TraceHeap): TraceEvent[] {
  const n = heap.names.length;
  const result: TraceEvent[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    result[i] = synthesizeEvent(heap, i);
  }
  return result.sort((left, right) => left.at - right.at);
}

function synthesizeNames(heap: TraceHeap): string[] {
  const n = heap.names.length;
  const ats = heap.ats;
  const indices: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    indices[i] = i;
  }
  indices.sort((a, b) => ats[a]! - ats[b]!);
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = heap.names[indices[i]!]!;
  }
  return out;
}

function collect<T>(fn: () => T): T extends Promise<infer R>
  ? Promise<{ ray: string; result: R; events: TraceEvent[]; names: string[] }>
  : { ray: string; result: T; events: TraceEvent[]; names: string[] } {
  const heap = createHeap();
  const ray = heap.ray;
  const previous = currentScope;
  currentScope = heap;

  let result: unknown;
  try {
    result = fn();
  } catch (error) {
    currentScope = previous;
    clearHeap(heap);
    throw error;
  }
  currentScope = previous;

  const finalize = (resolved: unknown) => {
    resolveUnresolvedMarkers();
    compactUnresolvedMarkers();
    const namesArr = synthesizeNames(heap);
    let cachedEvents: TraceEvent[] | undefined;
    const captured = {
      ray,
      result: resolved,
      names: namesArr,
      get events(): TraceEvent[] {
        if (!cachedEvents) {
          cachedEvents = synthesizeEvents(heap);
        }
        return cachedEvents;
      },
    };
    clearHeap(heap);
    return captured;
  };

  if (result && typeof (result as unknown as Promise<unknown>).then === "function") {
    pendingAsyncHeaps.set(heap, (pendingAsyncHeaps.get(heap) ?? 0) + 1);
    const slot = takeAsyncSlot(heap, "collect");
    const awaited = asyncPool[slot]!(result as PromiseLike<unknown>, slot, heap);
    return awaited.then(finalize) as ReturnType<typeof collect<T>>;
  }

  return finalize(result) as ReturnType<typeof collect<T>>;
}

function clearHeap(heap: TraceHeap): void {
  heaps.delete(heap.ray);
  releaseSlotsForHeap(heap);
  let write = 0;
  for (const marker of unresolvedMarkers) {
    if (marker.candidates.length !== 1 || marker.candidates[0] !== heap) {
      unresolvedMarkers[write] = marker;
      write += 1;
    }
  }
  unresolvedMarkers.length = write;
  if (latestHeap === heap) {
    latestHeap = undefined;
  }
}

type AnyConstructor = new (...args: any[]) => any;

function decorateClass<T extends AnyConstructor>(Cls: T): T {
  const proto = Cls.prototype;
  const className = Cls.name || "anonymous";
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor && typeof descriptor.value === "function") {
      Object.defineProperty(proto, key, {
        ...descriptor,
        value: wrap(descriptor.value, { name: `${className}.${key}` }),
      });
    }
  }
  return Cls;
}

function Trace<T extends AnyConstructor>(target: T): T;
function Trace(
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
): PropertyDescriptor;
function Trace(
  target: unknown,
  propertyKey?: string | symbol,
  descriptor?: PropertyDescriptor,
): unknown {
  if (propertyKey === undefined && descriptor === undefined) {
    return decorateClass(target as AnyConstructor);
  }
  if (descriptor && typeof descriptor.value === "function") {
    descriptor.value = wrap(descriptor.value, { name: String(propertyKey) });
    return descriptor;
  }
  return descriptor;
}

interface TraceApi {
  <T extends AnyFunction>(fn: T, options?: TraceOptions): TracedFunction<T>;
  collect: typeof collect;
  step: typeof step;
  subscribe: typeof subscribe;
}

const trace = wrap as TraceApi;
trace.collect = collect;
trace.step = step;
trace.subscribe = subscribe;

export { marker, trace, Trace };
