import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { LABELS } from '../src/CoreBrowserSignals';
import { METRIC_CAPTURE_EXAMPLES } from '../src/metricCaptureExamples';
import { METRIC_HELP, MetricInfo } from '../src/MetricInfo';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('documents every browser signal exposed by the dashboard', () => {
  expect(Object.keys(METRIC_HELP).sort()).toEqual(Object.keys(LABELS).sort());
  expect(Object.keys(METRIC_CAPTURE_EXAMPLES).sort()).toEqual(
    Object.keys(LABELS).sort(),
  );
});
it('opens metric-specific capture help and closes without changing chart selection', () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  render(<MetricInfo metric="cpu.pressure" title="CPU pressure" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'About CPU pressure' }));
  expect(
    screen.getByRole('dialog', { name: 'CPU pressure' }).textContent,
  ).toContain('PressureObserver');
  expect(screen.getByRole('dialog').textContent).toContain(
    'not a CPU percentage',
  );
  expect(screen.getByLabelText('Capture code example').textContent).toContain(
    "observer.observe('cpu', { sampleInterval: 1000 })",
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Close metric information' }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('explains a custom list without chart terminology', () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  render(
    <MetricInfo
      help={{
        capture: 'Parent links connect recorded frames.',
        chart: 'Each row is one distinct path.',
        meaning: 'Routes to the selected function.',
        presentation: 'list',
      }}
      metric="function.call-paths"
      title="Call paths"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'About Call paths' }));
  const dialog = screen.getByRole('dialog', { name: 'Call paths' });
  expect(dialog.textContent).toContain('How to read the list');
  expect(dialog.textContent).toContain('Each row is one distinct path.');
  expect(dialog.textContent).not.toContain('Empty slices');
});

it('keeps the dialog open when a text selection ends on its surface', () => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  render(
    <MetricInfo
      metric="memory.js-heap-high-water"
      title="Sampled heap high-water"
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'About Sampled heap high-water' }),
  );
  const dialog = screen.getByRole('dialog');
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    bottom: 300,
    height: 200,
    left: 100,
    right: 300,
    toJSON: () => undefined,
    top: 100,
    width: 200,
    x: 100,
    y: 100,
  });
  fireEvent(
    dialog.querySelector('p')!,
    new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 150,
      clientY: 150,
    }),
  );
  fireEvent.click(dialog, { clientX: 50, clientY: 150 });
  expect(screen.getByRole('dialog')).toBeTruthy();

  fireEvent(
    dialog,
    new MouseEvent('pointerdown', {
      bubbles: true,
      clientX: 50,
      clientY: 150,
    }),
  );
  fireEvent.click(dialog, { clientX: 50, clientY: 150 });
  expect(screen.queryByRole('dialog')).toBeNull();
});
