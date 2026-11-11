const MAX_DEPTH = 5;
const MAX_PROPERTIES = 20;
const MAX_NODES = 100;
const MAX_STRING_LENGTH = 8000;

interface SnapshotState {
  nodes: number;
  seen: WeakSet<object>;
}

/** Snapshot only a thrown value; never inspect the failed call's arguments. */
export function snapshotTraceError(value: unknown): unknown {
  try {
    return snapshot(value, 0, { nodes: 0, seen: new WeakSet() });
  } catch {
    // Diagnostic capture must not replace the exception raised by application code.
    return '[Uninspectable thrown value]';
  }
}

function snapshotPrimitive(value: unknown): unknown {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated]`
      : value;
  }
  const text =
    typeof value === 'function'
      ? '[Function]'
      : typeof value === 'bigint'
        ? `${value.toString()}n`
        : String(value);
  return snapshotPrimitive(text);
}

function snapshot(
  value: unknown,
  depth: number,
  state: SnapshotState,
): unknown {
  if (value === null || typeof value !== 'object') {
    return snapshotPrimitive(value);
  }
  if (state.seen.has(value)) {
    return '[Circular]';
  }
  if (depth >= MAX_DEPTH || state.nodes >= MAX_NODES) {
    return '[Truncated]';
  }
  state.seen.add(value);
  state.nodes++;

  // instanceof alone misses errors thrown by the viewer iframe or another realm.
  const tag = Object.prototype.toString.call(value);
  if (
    value instanceof Error ||
    tag === '[object Error]' ||
    tag === '[object DOMException]'
  ) {
    return snapshotErrorFields(value, depth, state);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_PROPERTIES)
      .map((item) => snapshot(item, depth + 1, state));
  }
  return snapshotRecord(value, depth, state);
}

function snapshotErrorFields(
  value: object,
  depth: number,
  state: SnapshotState,
) {
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'message', 'stack', 'code', 'cause']) {
    try {
      const field = Reflect.get(value, key);
      if (field !== undefined) {
        result[key] = snapshot(field, depth + 1, state);
      }
    } catch {
      result[key] = '[Unreadable]';
    }
  }
  return result;
}

function snapshotRecord(value: object, depth: number, state: SnapshotState) {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors).slice(
    0,
    MAX_PROPERTIES,
  )) {
    result[key] =
      'value' in descriptor
        ? snapshot(descriptor.value, depth + 1, state)
        : '[Getter/Setter]';
  }
  return result;
}
