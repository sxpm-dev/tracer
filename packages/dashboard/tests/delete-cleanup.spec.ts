// @vitest-environment node
import {
  addTraceExtensionSample,
  recordSession,
  releaseSession,
  trace,
} from '@sx/recordings';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRecordingClient, createSessionClient } from '../src/data';
import { startRecordingServer } from '../src/server';

let directory: string;
let server: Awaited<ReturnType<typeof startRecordingServer>>;

afterEach(async () => {
  if (server) {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
  if (directory) {
    await rm(directory, { force: true, recursive: true });
  }
});

async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listFiles(path)));
    } else {
      found.push(path.slice(root.length + 1));
    }
  }
  return found.sort();
}

describe('deleting a recording', () => {
  it('leaves no raw data, metadata, ray file or derived index behind', async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'trace-delete-'));
    const recordings = resolve(directory, 'recordings');
    // Served from source here, so the packaged UI directory does not exist yet.
    await writeFile(resolve(directory, 'index.html'), '<h1>Dashboard</h1>');
    server = await startRecordingServer({
      dashboardDirectory: directory,
      port: 0,
      recordingsDirectory: recordings,
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Missing port');
    }
    const url = `http://127.0.0.1:${address.port}`;

    await recordSession('Doomed', { cpu: false, serverUrl: url });
    trace(
      () => addTraceExtensionSample('example.channel', { value: 1 }),
      'work',
    )();
    const released = await releaseSession();

    // Reading the session builds the persistent SQLite index beside the data,
    // which is the artifact most easily orphaned on delete.
    await createSessionClient(url).summary(released.sessionId, '');
    const before = await listFiles(recordings);
    expect(
      before.filter((name) => name.includes(released.sessionId)).length,
    ).toBeGreaterThanOrEqual(4);
    expect(before.some((name) => name.endsWith('.sqlite'))).toBe(true);

    await createRecordingClient(url).remove(released.sessionId);

    const after = await listFiles(recordings);
    const leaked = after.filter(
      (name) => name.includes(released.sessionId) && !name.endsWith('.deleted'),
    );
    expect(leaked).toEqual([]);
    // A zero-byte tombstone is kept so the id is not treated as never-seen.
    expect(after).toEqual([`${released.sessionId}.deleted`]);
  });
});
