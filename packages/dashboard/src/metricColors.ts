/** Stable metric colors shared by overview and inspector charts. */
const colors: Record<string, string> = {
  'cpu.pressure': 'rose',
  'event.duration': 'blue',
  'event.input-delay': 'amber',
  'event.processing': 'violet',
  'frame.fps': 'green',
  'function.calls': 'violet',
  'layout.shift': 'pink',
  'memory.js-heap-high-water': 'teal',
  'memory.js-heap-used': 'teal',
  'memory.ua-total': 'cyan',
  'page.visibility': 'slate',
  'resource.duration': 'indigo',
  'resource.transfer-size': 'cyan',
  'thread.blocking': 'orange',
  'timer.lag': 'amber',
};

export function metricColor(metric: string): string {
  return `var(--cd-chart-${colors[metric] ?? 'violet'})`;
}
