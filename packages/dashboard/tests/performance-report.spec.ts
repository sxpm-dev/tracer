// @vitest-environment node
import { JSDOM } from 'jsdom';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import type { TraceRecording } from '../src/types';

import {
  baselineDelta,
  buildPerformanceReport,
  createSingleSessionConfig,
  durationBucket,
  rankReportFunctions,
  type ReportEvidence,
  safeRate,
  safeShare,
  summarizeBrowserSamples,
} from '../src/performanceReport';
import { exportReportEvidence, intervalUnion } from '../src/reportEvidence';
import { renderPerformanceReport } from '../src/reportHtml';

function recording(mode: TraceRecording['mode'] = 'full'): TraceRecording {
  return {
    duration: 100,
    mode,
    schemaVersion: 1,
    sessionId: 'fixture',
    startedAt: '2026-09-26T00:00:00Z',
    status: 'complete',
    title: 'Fixture',
    traces: [],
  };
}
function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE events(seq INTEGER PRIMARY KEY,ray TEXT,id INTEGER,parent INTEGER,namespace TEXT,name TEXT,kind TEXT,status TEXT,at REAL,duration REAL);
    CREATE TABLE browser_samples(metric TEXT,unit TEXT,at REAL,value REAL);
    CREATE TABLE cpu_samples(at REAL,blocking REAL);
    CREATE TABLE info(key TEXT PRIMARY KEY,value TEXT);`);
  const insert = db.prepare(
    'INSERT INTO events(ray,id,parent,namespace,name,kind,status,at,duration) VALUES(?,?,?,?,?,?,?,?,?)',
  );
  insert.run('ray', 1, null, 'Platform', 'root', 'call', '', 0, 100);
  insert.run('ray', 2, 1, 'Editor', 'same', 'call', '', 10, 30);
  insert.run('ray', 3, 1, 'Platform', 'same', 'call', 'error', 30, 50);
  insert.run('ray', 4, null, 'Editor', 'same', 'call', '', 80, 20);
  insert.run(
    'ray',
    5,
    null,
    'Platform',
    'render.cache-hit',
    'marker',
    '',
    0,
    0,
  );
  insert.run(
    'ray',
    6,
    null,
    'Platform',
    'render.cache-miss',
    'marker',
    '',
    0,
    0,
  );
  insert.run('ray', 7, null, 'Platform', 'only.cache-hit', 'marker', '', 0, 0);
  db.prepare('INSERT INTO browser_samples VALUES(?,?,?,?)').run(
    'frame.fps',
    'fps',
    0,
    60,
  );
  db.prepare('INSERT INTO browser_samples VALUES(?,?,?,?)').run(
    'frame.fps',
    'fps',
    10,
    20,
  );
  db.prepare('INSERT INTO browser_samples VALUES(?,?,?,?)').run(
    'frame.fps',
    'fps',
    20,
    40,
  );
  db.prepare('INSERT INTO cpu_samples VALUES(?,?)').run(10, 35);
  return db;
}

describe('performance report calculations', () => {
  it('attributes nested and overlapping calls to their own namespaces', async () => {
    const db = database();
    try {
      const evidence = await exportReportEvidence(
        db,
        recording(),
        new AbortController().signal,
      );
      const root = evidence.functions!.find((fn) => fn.name === 'root')!;
      const editor = evidence.functions!.find(
        (fn) => fn.namespace === 'Editor',
      )!;
      const platformSame = evidence.functions!.find(
        (fn) => fn.namespace === 'Platform' && fn.name === 'same',
      )!;
      expect(root).toMatchObject({
        calls: 1,
        inclusiveMs: 100,
        rootCalls: 1,
        rootTreeCalls: 3,
        selfMs: 30,
      });
      expect(editor).toMatchObject({
        calls: 2,
        inclusiveMs: 50,
        rootCalls: 1,
        rootInclusiveMs: 20,
        selfMs: 50,
      });
      expect(platformSame).toMatchObject({
        calls: 1,
        errors: 1,
        inclusiveMs: 50,
        rootCalls: 0,
      });
      expect(evidence.functions!.reduce((sum, fn) => sum + fn.selfMs, 0)).toBe(
        130,
      );
      expect(
        intervalUnion(
          [
            { end: 40, start: 10 },
            { end: 80, start: 30 },
          ],
          0,
          100,
        ),
      ).toBe(70);
      expect(root.buckets[5]).toBe(1);
      expect(editor.rootBuckets[3]).toBe(1);
      expect(
        evidence.browser.find((item) => item.metric === 'frame.fps'),
      ).toMatchObject({ count: 2, mean: 30, p95: 20 });
      expect(evidence.blockingMs).toBe(35);
      expect(
        evidence.cache!.find((item) => item.name === 'render')?.hitRate,
      ).toBe(0.5);
      expect(
        evidence.cache!.find((item) => item.name === 'only')?.hitRate,
      ).toBeNull();
    } finally {
      db.close();
    }
  });

  it('filters before ranking and keeps root totals distinct from all-call totals', async () => {
    const db = database();
    try {
      const evidence = await exportReportEvidence(
        db,
        recording(),
        new AbortController().signal,
      );
      const functions = evidence.functions!;
      expect(
        rankReportFunctions(functions, 'calls', 'all', 'Editor', 1)[0]
          .namespace,
      ).toBe('Editor');
      expect(
        rankReportFunctions(functions, 'calls', 'root', 'Editor', 1)[0]
          .rootCalls,
      ).toBe(1);
      expect(
        rankReportFunctions(functions, 'inclusiveMs', 'root', 'Platform', 1)[0]
          .rootInclusiveMs,
      ).toBe(100);
      const report = buildPerformanceReport(
        createSingleSessionConfig('fixture'),
        [evidence],
      );
      expect(report.sessions.fixture).toMatchObject({
        calls: 4,
        errors: 1,
        roots: 2,
      });
      expect(
        report.sessions.fixture.namespaces?.find(
          (item) => item.namespace === 'Editor',
        ),
      ).toMatchObject({ calls: 2, roots: 1, selfMs: 50 });
      expect(report.sessions.fixture.callsPerSecond).toBe(40);
      expect(
        report.sessions.fixture.namespaces?.find(
          (item) => item.namespace === 'Editor',
        )?.callSharePct,
      ).toBe(50);
      expect(
        report.sessions.fixture.namespaces?.find(
          (item) => item.namespace === 'Editor',
        )?.selfSharePct,
      ).toBeCloseTo((50 / 130) * 100);
    } finally {
      db.close();
    }
  });

  it('uses explicit zero and unavailable handling', () => {
    expect(safeRate(5, 0)).toBeNull();
    expect(safeShare(0, 0)).toBeNull();
    expect(baselineDelta(5, 0)).toBeNull();
    expect(baselineDelta(null, 1)).toBeNull();
    expect(baselineDelta(5, 10)).toBe(-50);
    expect(durationBucket(1)).toBe(1);
    expect(durationBucket(16.67)).toBe(3);
    expect(durationBucket(500)).toBe(6);
    expect(
      summarizeBrowserSamples([
        { at: 0, metric: 'timer.lag', unit: 'ms', value: 4 },
      ]),
    ).toEqual([]);
  });

  it('renders offline controls, scenario tabs, collapsed sections, and escaped content', async () => {
    const db = database();
    try {
      const evidence = await exportReportEvidence(
        db,
        recording(),
        new AbortController().signal,
      );
      const config = createSingleSessionConfig(
        'fixture',
        '<script>alert(1)</script>',
      );
      config.scenarios.push({
        baselineCheckpointId: 'base',
        checkpoints: [{ id: 'base', name: 'Baseline' }],
        id: 'second',
        name: 'Second',
        sessions: { base: 'missing' },
      });
      config.analysis = { conclusions: ['<img src=x onerror=alert(1)>'] };
      const report = buildPerformanceReport(config, [evidence]);
      const html = renderPerformanceReport(report);
      expect(html).toContain('role="tablist"');
      expect(html).toContain('data-ranking-filter="mode"');
      expect(html).toContain('data-ranking-filter="namespace"');
      expect(html).toContain('class="section-disclosure"');
      expect(html).toContain('id="evidence"');
      expect(html).toContain('id="print"');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('src="https://');
      expect(html).toContain('Missing recording');
      const dom = new JSDOM(html, { runScripts: 'dangerously' });
      const { document } = dom.window;
      expect(
        document.querySelector('.section-disclosure')?.hasAttribute('open'),
      ).toBe(false);
      const tabs = document.querySelectorAll<HTMLButtonElement>('[role="tab"]');
      tabs[1].click();
      expect(tabs[1].getAttribute('aria-selected')).toBe('true');
      expect(document.getElementById('scenario-0')?.hidden).toBe(true);
      tabs[0].click();
      const widget = document.querySelector('.ranking-widget')!;
      widget
        .querySelector<HTMLButtonElement>(
          '[data-ranking-filter="mode"][data-value="all"]',
        )!
        .click();
      expect(
        widget
          .querySelector('[data-mode="all"][data-namespace="all"]')
          ?.hasAttribute('hidden'),
      ).toBe(false);
      widget
        .querySelector<HTMLButtonElement>(
          '[data-ranking-filter="namespace"][data-value="Platform"]',
        )!
        .click();
      expect(
        widget
          .querySelector('[data-mode="all"][data-namespace="Platform"]')
          ?.hasAttribute('hidden'),
      ).toBe(false);
      dom.window.close();
    } finally {
      db.close();
    }
  });

  it('preserves mixed capture capabilities', () => {
    const browser: ReportEvidence = {
      ...recording('browser'),
      blockingCount: null,
      blockingMs: null,
      browser: [],
      cache: null,
      calculationVersion: 1,
      coverageNotes: [],
      durationMs: 100,
      functions: null,
    };
    const full: ReportEvidence = {
      ...browser,
      cache: [],
      functions: [],
      mode: 'full',
      sessionId: 'full',
    };
    const config = {
      scenarios: [
        {
          baselineCheckpointId: 'a',
          checkpoints: [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
          ],
          id: 'mixed',
          name: 'Mixed',
          sessions: { a: 'fixture', b: 'full' },
        },
      ],
      version: 1 as const,
    };
    const report = buildPerformanceReport(config, [browser, full]);
    expect(report.warnings).toContain(
      'Mixed: capture modes differ; compare only metrics recorded in both captures.',
    );
    expect(report.sessions.fixture.calls).toBeNull();
    expect(report.sessions.full.calls).toBe(0);
  });
});
