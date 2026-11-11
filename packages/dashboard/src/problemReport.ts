import type { CoreFinding, CoreFunctionStat } from './coreAnalysis';
import type { TraceRecording } from './types';

import { functionKey } from './coreAnalysis';
import { formatDuration } from './recording';

export function formatProblemReportMarkdown({
  dashboardUrl,
  findings,
  functions,
  rawRecordingUrl,
  recording,
}: {
  dashboardUrl?: string;
  findings: CoreFinding[];
  functions: CoreFunctionStat[];
  rawRecordingUrl?: string;
  recording: TraceRecording;
}): string {
  const lines = [
    '# Trace problems',
    '',
    `- **Recording:** ${recording.title || recording.sessionId}`,
    `- **Recording ID:** \`${recording.sessionId}\``,
    `- **Capture:** ${recording.mode === 'browser' ? 'Browser' : recording.mode === 'light' ? 'Light' : 'Full'}`,
    `- **Duration:** ${formatDuration(recording.duration)}`,
    `- **Findings:** ${findings.length}`,
  ];
  if (recording.startedAt) {
    lines.push(`- **Started:** ${recording.startedAt}`);
  }
  if (dashboardUrl) {
    lines.push(`- **Dashboard:** ${dashboardUrl}`);
  }
  if (rawRecordingUrl) {
    lines.push(`- **Raw recording:** ${rawRecordingUrl}`);
  }
  lines.push(
    '',
    'Findings indicate where to investigate; they do not prove a root cause.',
    '',
  );
  if (!findings.length) {
    lines.push('No problems were detected.');
  }
  findings.forEach((finding, index) => {
    const related = functions.find(
      (item) => functionKey(item.namespace, item.name) === finding.functionKey,
    );
    lines.push(
      `## ${index + 1}. ${finding.title}`,
      '',
      `- **Severity:** ${finding.severity}`,
      `- **Signal:** ${finding.metric}`,
      `- **Finding ID:** \`${finding.id}\``,
    );
    if (related) {
      lines.push(`- **Function:** \`${related.namespace}.${related.name}\``);
    }
    lines.push('', finding.description, '');
  });
  return lines.join('\n').trimEnd() + '\n';
}
