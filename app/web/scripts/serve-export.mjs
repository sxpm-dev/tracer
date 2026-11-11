import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('../out/', import.meta.url)));
const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) throw new Error('outside base');
    const local = decodeURIComponent(url.pathname.slice(base.length));
    let file = path.resolve(root, `.${local || '/'}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error('outside root');
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html');
    res.end(await readFile(path.join(root, '404.html')).catch(() => 'Not found'));
  }
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`Static preview: http://127.0.0.1:${server.address().port}${base}/`));
