import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { CoreRecordingDashboard } from '../src/CoreRecordingDashboard';
import { createSampleRecording } from '../src/sampleRecording';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

it('copies every problem with recording identity and the saved raw-data link', async () => {
  const recording = createSampleRecording();
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  render(
    <CoreRecordingDashboard
      navigation={{ onChange: () => undefined, state: { page: 'problems' } }}
      onCompare={() => undefined}
      onOpen={() => undefined}
      onRefresh={() => undefined}
      rawRecordingUrl="http://localhost/api/recordings/saved-session"
      recording={recording}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Warning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Copy as Markdown' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  const markdown = String(writeText.mock.calls[0][0]);
  expect(markdown).toContain(`# Trace problems`);
  expect(markdown).toContain(`**Recording ID:** \`${recording.sessionId}\``);
  expect(markdown).toContain(
    '**Raw recording:** http://localhost/api/recordings/saved-session',
  );
  expect(markdown).toContain('**Dashboard:**');
  expect(markdown).toContain('## 1. openDocument returned errors');
  expect(markdown).toContain('Main thread was blocked');
  expect(screen.getByRole('button', { name: 'Copied Markdown' })).toBeTruthy();
});
