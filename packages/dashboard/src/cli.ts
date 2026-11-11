#!/usr/bin/env node
import { parseArgs } from 'node:util';

import { startRecordingServer } from './server';

const { values } = parseArgs({
  options: {
    dashboard: { type: 'string' },
    help: { type: 'boolean' },
    host: { type: 'string' },
    port: { type: 'string' },
    recordings: { type: 'string' },
  },
});
if (values.help) {
  console.log(
    'trace-dashboard [--port 4178] [--host 127.0.0.1] [--recordings directory] [--dashboard built-ui-directory]',
  );
} else {
  const port = Number(values.port ?? 4178);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid port');
  }
  const server = await startRecordingServer({
    dashboardDirectory: values.dashboard,
    host: values.host,
    port,
    recordingsDirectory: values.recordings,
  });
  const address = server.address();
  console.log(
    `Trace dashboard: http://${values.host ?? '127.0.0.1'}:${typeof address === 'object' && address ? address.port : port}`,
  );
}
