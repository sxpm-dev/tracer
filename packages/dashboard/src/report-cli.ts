#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildPerformanceReport,
  validateReportConfig,
} from './performanceReport';
import { renderPerformanceReport } from './reportHtml';
import { createSessionClient } from './sessionData';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}
async function main() {
  const configPath = option('--config');
  const outputPath = option('--output');
  if (!configPath || !outputPath || process.argv.includes('--help')) {
    process.stdout.write(
      'Usage: trace-performance-report --config report.json --output report.html [--server http://127.0.0.1:4178] [--evidence evidence.json]\n',
    );
    if (!process.argv.includes('--help')) {
      process.exitCode = 2;
    }
    return;
  }
  const config = validateReportConfig(
    JSON.parse(await readFile(resolve(configPath), 'utf8')),
  );
  const client = createSessionClient(
    option('--server') ?? 'http://127.0.0.1:4178',
  );
  const ids = [
    ...new Set(
      config.scenarios.flatMap((scenario) =>
        Object.values(scenario.sessions).filter(Boolean),
      ),
    ),
  ];
  const evidence = [];
  for (const id of ids) {
    process.stderr.write(`Preparing ${id}…\n`);
    try {
      evidence.push(await client.reportEvidence(id));
    } catch (error) {
      if (!String(error).includes('(404)')) {
        throw error;
      }
      process.stderr.write(
        `Recording ${id} is unavailable; the report will mark that checkpoint missing.\n`,
      );
    }
  }
  const report = buildPerformanceReport(config, evidence);
  await writeFile(resolve(outputPath), renderPerformanceReport(report), 'utf8');
  const evidencePath = option('--evidence');
  if (evidencePath) {
    await writeFile(
      resolve(evidencePath),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
  }
  process.stderr.write(`Wrote ${outputPath}\n`);
}
void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
