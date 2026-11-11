export const METRIC_CAPTURE_EXAMPLES: Record<string, string> = {
  'cpu.pressure': `const levels = { nominal: 0, fair: 1, serious: 2, critical: 3 };
const observer = new PressureObserver(records => {
  for (const entry of records) {
    record(levels[entry.state], entry.time);
  }
});
await observer.observe('cpu', { sampleInterval: 1000 });
// On capture stop:
observer.disconnect();`,
  'event.duration': `const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    record(entry.duration, entry.startTime);
  }
});
observer.observe({ type: 'event', durationThreshold: 16 });
// On capture stop: observer.disconnect();`,
  'event.input-delay': `const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    record(entry.processingStart - entry.startTime, entry.startTime);
  }
});
observer.observe({ type: 'event', durationThreshold: 16 });
// On capture stop: observer.disconnect();`,
  'event.processing': `const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    record(entry.processingEnd - entry.processingStart, entry.startTime);
  }
});
observer.observe({ type: 'event', durationThreshold: 16 });
// On capture stop: observer.disconnect();`,
  'frame.fps': `let frames = 0;
let windowStart = performance.now();
function tick(now) {
  frames += 1;
  const elapsed = now - windowStart;
  if (elapsed >= 1000) {
    record(frames * 1000 / elapsed, now);
    frames = 0;
    windowStart = now;
  }
  requestId = requestAnimationFrame(tick);
}
let requestId = requestAnimationFrame(tick);
// On capture stop: cancelAnimationFrame(requestId);`,
  'layout.shift': `const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (!entry.hadRecentInput) {
      record(entry.value, entry.startTime);
    }
  }
});
observer.observe({ type: 'layout-shift' });
// On capture stop: observer.disconnect();`,
  'memory.js-heap-high-water': `// At a traced call's completion:
const endBytes = performance.memory?.usedJSHeapSize;
if (typeof endBytes === 'number') {
  record(endBytes, performance.now());
}
// The chart takes the largest endBytes in each time slice.`,
  'memory.js-heap-used': `const timer = setInterval(() => {
  const bytes = performance.memory?.usedJSHeapSize;
  if (typeof bytes === 'number') {
    record(bytes, performance.now());
  }
}, 1000);
// On capture stop: clearInterval(timer);`,
  'memory.ua-total': `// Called at most once per 5 seconds, with no overlapping request.
if (crossOriginIsolated && performance.measureUserAgentSpecificMemory) {
  const result = await performance.measureUserAgentSpecificMemory();
  record(result.bytes, performance.now());
}`,
  'page.visibility': `function captureVisibility() {
  record(document.visibilityState === 'visible' ? 1 : 0,
    performance.now());
}
captureVisibility();
document.addEventListener('visibilitychange', captureVisibility);
// On capture stop:
document.removeEventListener('visibilitychange', captureVisibility);`,
  'resource.duration': `const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.duration >= 50) {
      record(entry.duration, entry.startTime);
    }
  }
});
observer.observe({ type: 'resource' });
// On capture stop: observer.disconnect();`,
  'resource.transfer-size': `const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (entry.duration >= 50) {
      record(entry.transferSize, entry.startTime);
    }
  }
});
observer.observe({ type: 'resource' });
// On capture stop: observer.disconnect();`,
  'thread.blocking': `const type = PerformanceObserver.supportedEntryTypes
  .includes('long-animation-frame') ? 'long-animation-frame' : 'longtask';
const observer = new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    const blocked = type === 'long-animation-frame'
      ? Math.max(0, entry.blockingDuration ?? entry.duration - 50)
      : entry.duration;
    record(blocked, entry.startTime);
  }
});
observer.observe({ type });
// On capture stop: observer.disconnect();`,
  'timer.lag': `const intervalMs = 1000;
let expected = performance.now() + intervalMs;
const timer = setInterval(() => {
  const now = performance.now();
  record(Math.max(0, now - expected), now);
  expected = now + intervalMs;
}, intervalMs);
// On capture stop: clearInterval(timer);`,
};
