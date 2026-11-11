import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './serve-export.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
let timer;
let building = false;
let pending = false;
function rebuild() {
  if (building) { pending = true; return; }
  building = true;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./build.mjs', import.meta.url))], { stdio: 'inherit' });
  child.on('exit', () => {
    building = false;
    if (pending) { pending = false; rebuild(); }
    else console.log('Refresh the browser to see changes.');
  });
}
for (const directory of ['app/web/content', 'app/web/assets', 'app/web/lib', 'app/web/scripts', 'docs', 'packages']) {
  watch(`${root}${directory}`, { recursive: true }, (_, filename) => {
    if (!filename || !/\.(md|css|js|mjs)$/.test(filename) || /node_modules|\/dist\//.test(filename)) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  });
}
