import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
export async function ensureDashboardBuild() {
  try {
    await access(resolve(repositoryRoot, 'packages/dashboard/dist/cli.js'));
    await access(resolve(repositoryRoot, 'packages/dashboard/dist/dashboard/index.html'));
  } catch {
    console.log('Building dashboard packages for the first run…');
    await run('yarn', ['build']);
  }
}
function run(command, args) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd:repositoryRoot, stdio:'inherit' });
    const interrupt = () => child.kill('SIGINT');
    const terminate = () => child.kill('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      if (code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') done();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}
export async function launchDashboard(args = []) {
  await ensureDashboardBuild();
  await run(process.execPath, [resolve(repositoryRoot, 'packages/dashboard/dist/cli.js'), ...args]);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await launchDashboard(process.argv.slice(2));
}
