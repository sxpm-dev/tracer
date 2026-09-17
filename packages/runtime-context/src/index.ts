export interface Context<T> {
  provider(value: T): Provider<T>;
  get(): T;
}

export interface Provider<T> {
  run<R>(fn: () => R): R;
}

interface ContextFrame {
  parent: ContextFrame | undefined;
  key: symbol;
  value: unknown;
}

const FRAME_PREFIX = "__sx_ctx__";
const FRAME_RE = /__sx_ctx__(\d+)/;

let currentFrame: ContextFrame | undefined;

type AsyncSlot = <T>(value: PromiseLike<T>, slot: number) => Promise<T>;

const ASYNC_POOL_INITIAL = 64;
const asyncPool: AsyncSlot[] = [];
const slotInfo = new Map<number, ContextFrame>();
const slotsInFlight = new Set<number>();
let asyncSlotCursor = 0;

function buildAsyncSlot(slot: number): AsyncSlot {
  const frameName = `${FRAME_PREFIX}${slot}`;
  const holder = {
    async [frameName]<T>(value: PromiseLike<T>, slotId: number): Promise<T> {
      try {
        return await value;
      } finally {
        slotsInFlight.delete(slotId);
        slotInfo.delete(slotId);
      }
    },
  };
  return holder[frameName] as AsyncSlot;
}

for (let i = 0; i < ASYNC_POOL_INITIAL; i += 1) {
  asyncPool.push(buildAsyncSlot(i));
}

function takeAsyncSlot(frame: ContextFrame): number {
  for (let attempt = 0; attempt < asyncPool.length; attempt += 1) {
    const slot = asyncSlotCursor;
    asyncSlotCursor = (asyncSlotCursor + 1) % asyncPool.length;
    if (!slotsInFlight.has(slot)) {
      slotsInFlight.add(slot);
      slotInfo.set(slot, frame);
      return slot;
    }
  }

  const slot = asyncPool.length;
  asyncPool.push(buildAsyncSlot(slot));
  slotsInFlight.add(slot);
  slotInfo.set(slot, frame);
  return slot;
}

interface StackHolder {
  stack?: string;
}
const captureStackTrace = (Error as unknown as {
  captureStackTrace?: (target: object, constructorOpt?: Function) => void;
}).captureStackTrace;
const stackHolder: StackHolder = {};

function frameFromStack(): ContextFrame | undefined {
  let stack: string | undefined;
  if (captureStackTrace) {
    captureStackTrace(stackHolder, frameFromStack);
    stack = stackHolder.stack;
    stackHolder.stack = undefined;
  } else {
    stack = new Error().stack;
  }
  const match = stack?.match(FRAME_RE);
  if (!match) {
    return undefined;
  }
  return slotInfo.get(Number.parseInt(match[1]!, 10));
}

function activeFrame(): ContextFrame | undefined {
  if (currentFrame) return currentFrame;
  if (slotInfo.size === 0) return undefined;
  return frameFromStack();
}

export function capture<T extends (...args: any[]) => any>(fn: T): T {
  const captured = activeFrame();
  function captured_call(this: ThisParameterType<T>, ...args: Parameters<T>): ReturnType<T> {
    const previous = currentFrame;
    currentFrame = captured;
    try {
      return fn.apply(this, args);
    } finally {
      currentFrame = previous;
    }
  }
  return captured_call as T;
}

export function createContext<T>(): Context<T | undefined>;
export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T>(defaultValue?: T): Context<T | undefined> {
  const key = Symbol();

  function get(): T | undefined {
    let current = activeFrame();
    while (current) {
      if (current.key === key) {
        return current.value as T;
      }
      current = current.parent;
    }
    return defaultValue;
  }

  function provider(value: T): Provider<T> {
    return {
      run<R>(fn: () => R): R {
        const frame: ContextFrame = {
          parent: activeFrame(),
          key,
          value,
        };
        const previous = currentFrame;
        currentFrame = frame;

        let result: unknown;
        try {
          result = fn();
        } catch (error) {
          currentFrame = previous;
          throw error;
        }
        currentFrame = previous;

        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          const slot = takeAsyncSlot(frame);
          return asyncPool[slot]!(result as PromiseLike<unknown>, slot) as R;
        }

        return result as R;
      },
    };
  }

  return { get, provider };
}
