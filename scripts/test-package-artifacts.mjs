import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(resolve(tmpdir(), 'sx-package-test-'));
const run = (command, args, cwd = directory) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
});
try {
  await mkdir(resolve(directory, 'artifacts'));
  await writeFile(resolve(directory, 'package.json'), JSON.stringify({ private: true }));
  const archives = [];
  for (const name of ['tracing', 'recordings', 'dashboard']) {
    const packed = JSON.parse(run('npm', ['pack', resolve(root, 'packages', name), '--json', '--pack-destination', resolve(directory, 'artifacts')]));
    archives.push(resolve(directory, 'artifacts', packed[0].filename));
  }
  run('npm', ['install', '--ignore-scripts', '--omit=peer', '--no-audit', '--no-fund', ...archives]);
  const fixture = `import { trace } from '@sx/tracing';\nimport { recordSession } from '@sx/recordings';\nimport { startRecordingServer } from '@sx/dashboard/server';\nvoid [trace, recordSession, startRecordingServer];\n`;
  for (const extension of ['cts', 'mts']) {
    await writeFile(resolve(directory, `consumer.${extension}`), fixture);
    run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '--module', 'Node16', '--moduleResolution', 'Node16', '--target', 'ES2022', '--skipLibCheck', '--noEmit', `consumer.${extension}`]);
  }
  console.log('PASS: packed ESM and CommonJS TypeScript declarations');
  await copyFile(resolve(root, 'scripts/fixtures/package-consumer.mjs'), resolve(directory, 'consumer.mjs'));
  console.log(run(process.execPath, ['consumer.mjs']).trim());
} catch (error) {
  console.error(error.stdout?.toString() || '', error.stderr?.toString() || '');
  throw error;
} finally {
  await rm(directory, { recursive: true, force: true });
}
