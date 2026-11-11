import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRecordingMiddleware } from './recordingServer';

export { createRecordingMiddleware, resolveRecordingsDirectory } from './recordingServer';

export interface RecordingServerOptions {
  dashboardDirectory?: string;
  host?: string;
  port?: number;
  recordingsDirectory?: string;
}

/** Serve the packaged dashboard, or a consumer's built static dashboard. */
export async function startRecordingServer(
  options: RecordingServerOptions = {},
) {
  const middleware = createRecordingMiddleware(options);
  const root = await realpath(
    options.dashboardDirectory ??
      resolve(dirname(fileURLToPath(import.meta.url)), 'dashboard'),
  );
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      void serveFile(root, request.url ?? '/', request.method ?? 'GET')
        .then(({ body, type }) => {
          response.setHeader('content-type', type);
          response.end(request.method === 'HEAD' ? undefined : body);
        })
        .catch(() => {
          response.statusCode = 404;
          response.end('Not found');
        });
    });
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4178, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      done();
    });
  });
  return server;
}

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
async function serveFile(root: string, url: string, method: string) {
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error('Unsupported method');
  }
  const rawPathname = new URL(url, 'http://localhost').pathname;
  const pathname = decodeURIComponent(rawPathname);
  const appRoute =
    /^\/(?:reports|sample\/(?:full|light)(?:\/[^/]+)?|sessions\/[^/]+(?:\/[^/]+)?|local(?:\/[^/]+)?)\/?$/.test(
      rawPathname,
    );
  const file = await realpath(
    resolve(
      root,
      `.${pathname === '/' || appRoute ? '/index.html' : pathname}`,
    ),
  );
  if (!file.startsWith(`${root}${sep}`)) {
    throw new Error('Outside dashboard directory');
  }
  return {
    body: await readFile(file),
    type: contentTypes[extname(file)] ?? 'application/octet-stream',
  };
}
