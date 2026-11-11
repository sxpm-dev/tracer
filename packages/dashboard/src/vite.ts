import type { Plugin } from 'vite';

import { createRecordingMiddleware } from './recordingServer';

export function recordingsServer(
  options: Parameters<typeof createRecordingMiddleware>[0] = {},
): Plugin {
  const middleware = createRecordingMiddleware(options);
  return {
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    name: 'trace-recordings-server',
  };
}
