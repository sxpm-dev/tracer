import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import type { TraceEvent, TraceExtensionSample, TraceRecording } from './types';

import {
  addCallPath,
  type CallPath,
  type CallPathFrame,
  sortedCallPaths,
} from './callPaths';
import { analyzeCoreRecording } from './coreAnalysis';
import { bucketWidth, oneSecondBuckets } from './lightWindowBuckets';
import { selectedNamespaces } from './namespaceSelection';
import { exportReportEvidence } from './reportEvidence';
import {
  type FramePage,
  SESSION_PAGE_SIZE,
  type SessionSummary,
} from './sessionData';
import { queryOffset, querySummary } from './sessionQuery';
import { exportIndexedSnapshot, type SnapshotProgress } from './snapshotExport';
import { legacyEventOffset } from './timeline';

const VERSION = 9;
const preparation = new Map<
  string,
  { bytes: number; phase: string; totalBytes: number }
>();
export function indexProgress(path: string) {
  return (
    preparation.get(path) ?? {
      bytes: 0,
      phase: 'Waiting to prepare',
      totalBytes: 0,
    }
  );
}
const builds = new Map<string, Promise<void>>();
interface IndexedLine {
  events?: TraceEvent[];
  ray?: string;
  sample?: TraceExtensionSample & {
    at?: number;
    blockingDuration?: number;
    metric?: string;
    unit?: string;
    value?: number;
  };
  type: string;
}
interface Position {
  bytes: number;
  offset: number;
}
interface EventPointer extends Position {
  event_index: number;
}

/** Derivative cache only. Source recordings are never modified. */
export async function queryIndexedSession(
  path: string,
  recording: TraceRecording,
  kind: string,
  params: URLSearchParams,
  signal: AbortSignal,
  snapshot?: { mtimeMs: number; size: number },
  onProgress?: (progress: SnapshotProgress) => void,
) {
  const fingerprint = snapshot ?? (await stat(path));
  const index = `${dirname(path)}/.dashboard-index/${recording.sessionId}.sqlite`;
  const identity = `${VERSION}:${fingerprint.size}:${fingerprint.mtimeMs}:${recording.status}:${recording.mode}:${recording.duration}`;
  await ensureIndex(path, index, identity, recording, signal);
  signal.throwIfAborted();
  const db = new DatabaseSync(index, { readOnly: true });
  try {
    db.exec('PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;');
    if (kind === 'report-evidence') {
      return await exportReportEvidence(db, recording, signal, onProgress);
    }
    if (kind === 'export') {
      return await exportIndexedSnapshot(
        db,
        readSummary(db, recording, ''),
        signal,
        onProgress,
      );
    }
    if (kind === 'analytics') {
      return readAnalytics(db, recording, params);
    }
    if (kind === 'call-paths') {
      return readCallPaths(db, params, signal);
    }
    if (kind === 'summary') {
      return readSummary(db, recording, params.get('root') ?? '');
    }
    if (kind === 'rays') {
      return readRays(db, params);
    }
    if (kind === 'extensions') {
      return await readExtensions(db, path, params, signal);
    }
    return await readFrames(db, path, params, signal);
  } finally {
    db.close();
  }
}
function currentIndex(index: string, identity: string) {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(index, { readOnly: true });
    return (
      db.prepare('SELECT value FROM info WHERE key=?').get('identity')
        ?.value === identity
    );
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
async function ensureIndex(
  path: string,
  index: string,
  identity: string,
  recording: TraceRecording,
  signal: AbortSignal,
) {
  if (currentIndex(index, identity)) {
    return;
  }
  const previous = builds.get(index);
  if (previous) {
    await previous.catch(() => undefined);
    signal.throwIfAborted();
    return ensureIndex(path, index, identity, recording, signal);
  }
  const pending = buildIndex(path, index, identity, recording, signal);
  builds.set(index, pending);
  try {
    await pending;
  } finally {
    if (builds.get(index) === pending) {
      builds.delete(index);
    }
  }
}
const SCHEMA = `
PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-8192; PRAGMA temp_store=FILE;
CREATE TABLE info(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE events(seq INTEGER PRIMARY KEY, ray TEXT, id INTEGER, parent INTEGER, namespace TEXT, name TEXT, kind TEXT, status TEXT, at REAL, duration REAL, offset INTEGER, bytes INTEGER, event_index INTEGER);
CREATE TABLE samples(channel TEXT, offset INTEGER, bytes INTEGER);
CREATE TABLE browser_samples(metric TEXT, unit TEXT, at REAL, value REAL);
CREATE TABLE cpu_samples(at REAL, blocking REAL);
CREATE TABLE metadata(ray TEXT, owner TEXT, value TEXT, PRIMARY KEY(ray,owner));
BEGIN;
`;
async function buildIndex(
  path: string,
  index: string,
  identity: string,
  recording: TraceRecording,
  signal: AbortSignal,
) {
  await mkdir(dirname(index), { recursive: true });
  const temporary = `${index}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  const db = new DatabaseSync(temporary);
  try {
    db.exec(SCHEMA);
    const insert = createWriter(db);
    const snapshotSize = Number(identity.split(':')[1]);
    preparation.set(path, {
      bytes: 0,
      phase: 'Extracting events',
      totalBytes: snapshotSize,
    });
    await scanLines(
      path,
      (line, position) => {
        insert(JSON.parse(line) as IndexedLine, position);
        preparation.set(path, {
          bytes: position.offset + position.bytes,
          phase: 'Extracting events',
          totalBytes: snapshotSize,
        });
      },
      signal,
      snapshotSize,
    );
    signal.throwIfAborted();
    const bounds = db
      .prepare('SELECT min(at) AS minimum, max(at) AS maximum FROM events')
      .get()!;
    const timeOffset = legacyEventOffset(
      recording,
      Number(bounds.minimum),
      Number(bounds.maximum),
    );
    if (timeOffset) {
      db.prepare('UPDATE events SET at=max(0,at-?)').run(timeOffset);
    }
    preparation.set(path, {
      bytes: snapshotSize,
      phase: 'Building search indexes',
      totalBytes: snapshotSize,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    db.exec(`COMMIT;
      CREATE INDEX event_ray ON events(ray,id);
      CREATE INDEX event_parent ON events(ray,parent);
      CREATE INDEX event_function ON events(namespace,name);
      CREATE INDEX event_duration ON events(duration DESC,seq);
      CREATE INDEX event_time ON events(at,seq);
      CREATE INDEX sample_channel ON samples(channel);
      CREATE INDEX browser_sample_metric ON browser_samples(metric,at);
      CREATE TABLE rays AS SELECT ray, count(*) AS calls, sum(status='error') AS errors, min(at) AS startedAt, max(at+duration)-min(at) AS duration, min(seq) AS first FROM events WHERE kind='call' GROUP BY ray;
      ALTER TABLE rays ADD COLUMN name TEXT;
      UPDATE rays SET name=(SELECT namespace||'.'||name FROM events WHERE seq=rays.first);
      CREATE INDEX ray_name ON rays(name,ray);
      CREATE INDEX ray_time ON rays(startedAt,ray);
      CREATE INDEX ray_id ON rays(ray);
    `);
    preparation.set(path, {
      bytes: snapshotSize,
      phase: 'Preparing analytics',
      totalBytes: snapshotSize,
    });
    const summary = await querySummary(
      path,
      recording,
      '',
      signal,
      snapshotSize,
      timeOffset,
    );
    const save = db.prepare('INSERT INTO info VALUES (?,?)');
    save.run('summary', JSON.stringify(summary));
    save.run('identity', identity);
    save.run('timeOffset', String(timeOffset));
    signal.throwIfAborted();
  } catch (error) {
    preparation.delete(path);
    db.close();
    await rm(temporary, { force: true });
    throw error;
  }
  db.close();
  await rename(temporary, index);
  preparation.delete(path);
}
function createWriter(db: DatabaseSync) {
  const eventInsert = db.prepare(
    'INSERT INTO events(ray,id,parent,namespace,name,kind,status,at,duration,offset,bytes,event_index) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
  );
  const sampleInsert = db.prepare('INSERT INTO samples VALUES(?,?,?)');
  const browserInsert = db.prepare(
    'INSERT INTO browser_samples VALUES(?,?,?,?)',
  );
  const cpuInsert = db.prepare('INSERT INTO cpu_samples VALUES(?,?)');
  const metadataInsert = db.prepare(
    'INSERT OR REPLACE INTO metadata VALUES(?,?,?)',
  );
  const writeEvents = (line: IndexedLine, position: Position) => {
    if (line.type !== 'events' || !line.ray) {
      return;
    }
    (line.events ?? []).forEach((event, index) => {
      eventInsert.run(
        line.ray!,
        event.id,
        event.parent ?? null,
        event.namespace || 'unknown',
        event.name,
        event.kind,
        event.status ?? '',
        event.at,
        event.duration ?? 0,
        position.offset,
        position.bytes,
        index,
      );
    });
  };
  const writeBrowserSample = (line: IndexedLine) => {
    if (line.type === 'browser-sample' && line.sample) {
      browserInsert.run(
        line.sample.metric ?? '',
        line.sample.unit ?? '',
        line.sample.at ?? 0,
        line.sample.value ?? 0,
      );
    }
  };
  const writeCpuSample = (line: IndexedLine) => {
    if (line.type === 'cpu-sample' && line.sample) {
      cpuInsert.run(line.sample.at ?? 0, line.sample.blockingDuration ?? 0);
    }
  };
  const writeExtension = (line: IndexedLine, position: Position) => {
    if (line.type !== 'extension-sample' || !line.sample) {
      return;
    }
    sampleInsert.run(line.sample.channel, position.offset, position.bytes);
    if (line.sample.channel === 'tracing.ray-metadata') {
      const data = line.sample.data as {
        owner: string;
        ray: string;
        value: unknown;
      };
      if (data?.ray && data.owner) {
        metadataInsert.run(data.ray, data.owner, JSON.stringify(data.value));
      }
    }
  };
  return (line: IndexedLine, position: Position) => {
    writeEvents(line, position);
    writeBrowserSample(line);
    writeCpuSample(line);
    writeExtension(line, position);
  };
}
/** Byte offsets remain correct for UTF-8, CRLF, and lines crossing chunks. */
async function scanLines(
  path: string,
  consume: (line: string, position: Position) => void,
  signal: AbortSignal,
  size: number,
) {
  if (!size) {
    return;
  }
  const stream = createReadStream(path, {
    end: size - 1,
    highWaterMark: 256 * 1024,
    signal,
  });
  let buffer: Buffer = Buffer.alloc(0);
  let offset = 0;
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      buffer = Buffer.concat([buffer, chunk as Buffer]);
      let start = 0;
      for (
        let end = buffer.indexOf(10);
        end !== -1;
        end = buffer.indexOf(10, start)
      ) {
        const line = buffer.subarray(start, end).toString('utf8');
        if (line.trim()) {
          consume(line, { bytes: end - start, offset: offset + start });
        }
        start = end + 1;
      }
      offset += start;
      buffer = buffer.subarray(start);
    }
    if (buffer.toString('utf8').trim()) {
      consume(buffer.toString('utf8'), { bytes: buffer.length, offset });
    }
  } finally {
    stream.destroy();
  }
}
function readSummary(
  db: DatabaseSync,
  recording: TraceRecording,
  root: string,
): SessionSummary {
  const result = JSON.parse(
    String(
      db.prepare("SELECT value FROM info WHERE key='summary'").get()!.value,
    ),
  ) as SessionSummary;
  result.recording = recording;
  if (!root) {
    return result;
  }
  const functions = db
    .prepare(
      `SELECT namespace,name,count(*) AS calls,sum(status='error') AS errors,sum(duration) AS totalDuration,max(duration) AS maxDuration,min(duration) AS minDuration FROM events WHERE kind='call' AND ray IN (SELECT ray FROM rays WHERE name=?) GROUP BY namespace,name`,
    )
    .all(root);
  const analysis = analyzeCoreRecording({
    ...recording,
    aggregates: functions as unknown as NonNullable<
      TraceRecording['aggregates']
    >,
    mode: 'light',
  });
  return {
    ...result,
    analysis: {
      ...result.analysis,
      ...analysis,
      activity: rootActivity(db, root, recording.duration),
      blocking: result.analysis.blocking,
      blockingTotal: result.analysis.blockingTotal,
      rootActivity: rootActivity(db, root, recording.duration, true),
      roots: result.analysis.roots,
      timelineBlocking: result.analysis.timelineBlocking,
    },
  };
}
function rootActivity(
  db: DatabaseSync,
  root: string,
  duration: number,
  rootsOnly = false,
) {
  const activity = oneSecondBuckets(duration);
  const rows = db
    .prepare(
      `SELECT min(?,max(0,cast(at / 1000 AS INTEGER))) AS bucket, count(*) AS calls FROM events WHERE kind='call' AND ray IN (SELECT ray FROM rays WHERE name=?)${rootsOnly ? ' AND parent IS NULL' : ''} GROUP BY bucket`,
    )
    .all(activity.length - 1, root);
  for (const row of rows) {
    activity[Number(row.bucket)] = Number(row.calls);
  }
  return activity;
}
function readRays(db: DatabaseSync, params: URLSearchParams) {
  const query = (params.get('q') ?? '').toLowerCase();
  const offset = queryOffset(params);
  const where = "instr(lower(name||' '||ray),?) > 0";
  const total = Number(
    db.prepare(`SELECT count(*) AS count FROM rays WHERE ${where}`).get(query)!
      .count,
  );
  const items = db
    .prepare(
      `SELECT ray,name,calls,errors,duration,startedAt FROM rays WHERE ${where} ORDER BY startedAt,ray LIMIT ? OFFSET ?`,
    )
    .all(query, SESSION_PAGE_SIZE, offset);
  return { items, offset, total };
}
function frameFilter(params: URLSearchParams) {
  const clauses: string[] = [];
  const values: SQLInputValue[] = [];
  const add = (sql: string, value: SQLInputValue) => {
    clauses.push(sql);
    values.push(value);
  };
  for (const key of ['ray', 'name']) {
    if (params.get(key)) {
      add(`${key}=?`, params.get(key)!);
    }
  }
  const namespaces = selectedNamespaces(params.get('namespace') ?? undefined);
  if (namespaces.length) {
    clauses.push(`namespace IN (${namespaces.map(() => '?').join(',')})`);
    values.push(...namespaces);
  }
  if (params.get('q')) {
    add(
      "instr(lower(namespace||'.'||name),?)>0",
      params.get('q')!.toLowerCase(),
    );
  }
  if (params.get('root')) {
    add('ray IN (SELECT ray FROM rays WHERE name=?)', params.get('root')!);
  }
  if (params.get('rootsOnly') === 'true') {
    clauses.push('parent IS NULL');
  }
  addKindFilter(params.get('kind'), add);
  addNumberFilters(params, add);
  return {
    values,
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
  };
}
function addKindFilter(
  kind: null | string,
  add: (sql: string, value: SQLInputValue) => void,
) {
  if (kind === 'error') {
    add('status=?', 'error');
  }
  if (kind === 'call' || kind === 'marker') {
    add('kind=?', kind);
  }
}
function addNumberFilters(
  params: URLSearchParams,
  add: (sql: string, value: SQLInputValue) => void,
) {
  for (const [key, sql] of [
    ['minDuration', 'duration>=?'],
    ['maxDuration', 'duration<=?'],
    ['from', 'at>=?'],
    ['to', 'at<?'],
    ['parent', 'parent=?'],
  ]) {
    if (params.has(key) && Number.isFinite(Number(params.get(key)))) {
      add(sql, Number(params.get(key)));
    }
  }
}
const FRAME_ORDERS: Record<string, string> = {
  duration: 'duration DESC,seq',
  'duration-asc': 'duration,seq',
  time: 'at,seq',
  'time-desc': 'at DESC,seq',
};
async function readFrames(
  db: DatabaseSync,
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<FramePage> {
  if (params.has('subtree')) {
    return readSubtree(db, path, params, signal);
  }
  const { values, where } = frameFilter(params);
  const offset = queryOffset(params);
  const total = Number(
    db.prepare(`SELECT count(*) AS count FROM events ${where}`).get(...values)!
      .count,
  );
  const order = FRAME_ORDERS[params.get('sort') ?? ''] ?? 'seq';
  const items = db
    .prepare(
      `SELECT ray,id,parent,namespace,name,kind,status,at,duration FROM events ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...values, SESSION_PAGE_SIZE, offset) as unknown as TraceEvent[];
  const countChildren = db.prepare(
    'SELECT count(*) AS count FROM events WHERE ray=? AND parent=?',
  );
  const withChildren = items.map((item) => ({
    ...item,
    childCount: Number(countChildren.get(item.ray, item.id)!.count),
  }));
  const selected = await readSelectedFrame(db, path, params, signal);
  const ray = selected?.ray ?? params.get('ray');
  const metadata = Object.fromEntries(
    db
      .prepare('SELECT owner,value FROM metadata WHERE ray=?')
      .all(ray ?? '')
      .map((row) => [String(row.owner), JSON.parse(String(row.value))]),
  );
  return { items: withChildren, metadata, offset, selected, total };
}
async function readSelectedFrame(
  db: DatabaseSync,
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
) {
  if (!params.has('frame')) {
    return undefined;
  }
  const row = db
    .prepare(
      'SELECT offset,bytes,event_index FROM events WHERE ray=? AND id=? LIMIT 1',
    )
    .get(
      params.get('frameRay') ?? params.get('ray') ?? '',
      Number(params.get('frame')),
    ) as unknown as EventPointer | undefined;
  if (!row) {
    return undefined;
  }
  const line = await readLine(path, row, signal);
  const event = line.events?.[row.event_index];
  const offset = Number(
    db.prepare("SELECT value FROM info WHERE key='timeOffset'").get()?.value ??
      0,
  );
  return event ? { ...event, at: Math.max(0, event.at - offset) } : undefined;
}
async function readLine(
  path: string,
  position: Position,
  signal: AbortSignal,
): Promise<IndexedLine> {
  signal.throwIfAborted();
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(position.bytes);
    await file.read(buffer, 0, buffer.length, position.offset);
    signal.throwIfAborted();
    return JSON.parse(buffer.toString('utf8')) as IndexedLine;
  } finally {
    await file.close();
  }
}
async function readExtensions(
  db: DatabaseSync,
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
) {
  const channel = params.get('channel') ?? '';
  const offset = queryOffset(params);
  const total = Number(
    db
      .prepare('SELECT count(*) AS count FROM samples WHERE channel=?')
      .get(channel)!.count,
  );
  const positions = db
    .prepare(
      'SELECT offset,bytes FROM samples WHERE channel=? ORDER BY rowid LIMIT ? OFFSET ?',
    )
    .all(channel, SESSION_PAGE_SIZE, offset) as unknown as Position[];
  const items: TraceExtensionSample[] = [];
  for (const position of positions) {
    const line = await readLine(path, position, signal);
    if (line.sample) {
      items.push(line.sample);
    }
  }
  return { items, offset, total };
}

function readAnalytics(
  db: DatabaseSync,
  recording: TraceRecording,
  params: URLSearchParams,
) {
  const { values, where } = frameFilter(params);
  const condition = `${where || 'WHERE 1=1'} AND kind='call'`;
  const requestedLimit = Number(params.get('functionLimit'));
  const functionLimit =
    Number.isSafeInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : undefined;
  const functions = db
    .prepare(
      `SELECT namespace,name,count(*) AS calls,sum(status='error') AS errors,sum(duration) AS totalDuration,max(duration) AS maxDuration,min(duration) AS minDuration FROM events ${condition} GROUP BY namespace,name${functionLimit ? ' ORDER BY totalDuration DESC,namespace,name LIMIT ?' : ''}`,
    )
    .all(...values, ...(functionLimit ? [functionLimit] : []));
  // Must match the array width, or SQL would bucket by the second while the
  // capped array covers more, clamping everything past the cap into the last.
  const bucketMs = bucketWidth(recording.duration);
  const counts = oneSecondBuckets(recording.duration);
  const rows = db
    .prepare(
      `SELECT min(?, max(0,cast(at / ? AS INTEGER))) AS bucket,count(*) AS calls,sum(parent IS NULL) AS roots FROM events ${condition} GROUP BY bucket`,
    )
    .all(counts.length - 1, bucketMs, ...values);
  const chartRootCounts = oneSecondBuckets(recording.duration);
  for (const row of rows) {
    const index = Number(row.bucket);
    counts[index] = Number(row.calls);
    chartRootCounts[index] = Number(row.roots);
  }
  return {
    bucketMs,
    chartCounts: counts,
    chartRootCounts,
    counts,
    functions,
    rootTotal: chartRootCounts.reduce((a, b) => a + b, 0),
    total: counts.reduce((a, b) => a + b, 0),
  };
}

function readCallPaths(
  db: DatabaseSync,
  params: URLSearchParams,
  signal: AbortSignal,
): CallPath[] {
  if (!params.get('name')) {
    return [];
  }
  const { values, where } = frameFilter(params);
  const condition = `${where || 'WHERE 1=1'} AND kind='call'`;
  const calls = db.prepare(
    `SELECT ray,id,parent,namespace,name FROM events ${condition}`,
  );
  const parent = db.prepare(
    'SELECT id,parent,namespace,name,kind FROM events WHERE ray=? AND id=? LIMIT 1',
  );
  const paths = new Map<string, CallPath>();
  for (const row of calls.iterate(...values)) {
    signal.throwIfAborted();
    const frames: CallPathFrame[] = [
      {
        kind: 'call',
        name: String(row.name),
        namespace: String(row.namespace),
      },
    ];
    const seen = new Set([Number(row.id)]);
    let parentId = row.parent;
    while (parentId != null && frames.length < 256) {
      const ancestor = parent.get(row.ray, parentId);
      if (!ancestor || seen.has(Number(ancestor.id))) {
        break;
      }
      seen.add(Number(ancestor.id));
      frames.unshift({
        kind: ancestor.kind === 'marker' ? 'marker' : 'call',
        name: String(ancestor.name),
        namespace: String(ancestor.namespace),
      });
      parentId = ancestor.parent;
    }
    addCallPath(paths, frames);
  }
  return sortedCallPaths(paths);
}

async function readSubtree(
  db: DatabaseSync,
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<FramePage> {
  const ray = params.get('ray') ?? '';
  const parent = Number(params.get('subtree'));
  const cte = `WITH RECURSIVE stack AS (
    SELECT *, 0 AS depth, printf('%012d',seq) AS trail, '[]' AS ancestors FROM events WHERE ray=? AND id=?
    UNION ALL
    SELECT e.*, stack.depth+1, stack.trail||'.'||printf('%012d',e.seq),
      json_insert(stack.ancestors,'$[#]',json_object('id',stack.id,'name',stack.name))
    FROM events e JOIN stack ON e.ray=stack.ray AND e.parent=stack.id WHERE stack.depth<256 AND instr('.'||stack.trail||'.','.'||printf('%012d',e.seq)||'.')=0
  )`;
  const filterParams = new URLSearchParams(params);
  for (const key of ['parent', 'rootsOnly', 'subtree']) {
    filterParams.delete(key);
  }
  const { values, where } = frameFilter(filterParams);
  const stackWhere = where
    ? `WHERE depth=0 OR (${where.slice('WHERE '.length)})`
    : '';
  const offset = queryOffset(params);
  const total = Number(
    db
      .prepare(cte + ` SELECT count(*) AS count FROM stack ${stackWhere}`)
      .get(ray, parent, ...values)!.count,
  );
  const items = db
    .prepare(
      cte +
        ` SELECT ray,id,parent,namespace,name,kind,status,at,duration,depth,ancestors,
    (SELECT count(*) FROM events child WHERE child.ray=stack.ray AND child.parent=stack.id) AS childCount
    FROM stack ${stackWhere} ORDER BY trail LIMIT ? OFFSET ?`,
    )
    .all(ray, parent, ...values, SESSION_PAGE_SIZE, offset)
    .map((row) => ({
      ...row,
      ancestors: JSON.parse(String(row.ancestors)),
    })) as unknown as FramePage['items'];
  const selected = await readSelectedFrame(db, path, params, signal);
  const metadata = Object.fromEntries(
    db
      .prepare('SELECT owner,value FROM metadata WHERE ray=?')
      .all(ray)
      .map((row) => [String(row.owner), JSON.parse(String(row.value))]),
  );
  return { items, metadata, offset, selected, total };
}

/** Wait out any in-flight build before removing a derivative index. */
export async function discardSessionIndex(path: string, sessionId: string) {
  const index = `${dirname(path)}/.dashboard-index/${sessionId}.sqlite`;
  await builds.get(index)?.catch(() => undefined);
  preparation.delete(path);
  await Promise.all(
    ['', '-wal', '-shm', '-journal'].map((suffix) =>
      rm(index + suffix, { force: true }),
    ),
  );
}
