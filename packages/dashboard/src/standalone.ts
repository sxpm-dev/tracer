import type { TraceRecording } from './types';

import { dashboardRouteUrl } from './navigation';
import {
  createStandaloneSnapshot,
  type StandaloneSnapshot,
} from './standaloneSnapshot';

export * from './standaloneSnapshot';

export interface StandaloneDashboardAssets {
  css: string;
  javascript: string;
}

/**
 * Creates a portable copy of the real dashboard. The same compiled React
 * application and stylesheet that are currently running are embedded beside
 * the recording, rather than maintaining a second standalone-only UI.
 */
export async function createStandaloneHtmlBlob(
  recording: TraceRecording,
  onProgress?: (progress: number) => void,
  suppliedAssets?: StandaloneDashboardAssets,
  suppliedSnapshot?: StandaloneSnapshot,
): Promise<Blob> {
  onProgress?.(0);
  const assets = suppliedAssets ?? (await loadDashboardAssets());
  const snapshot =
    suppliedSnapshot ??
    (await createStandaloneSnapshot(recording, { onProgress }));
  const parts: BlobPart[] = [
    documentStart(recording, assets.css),
    safeJson(snapshot),
    `</script><script>document.documentElement.dataset.dashboardTheme=${safeJson(snapshot.theme ?? 'light')};if (!window.location.hash) window.location.hash=${safeJson(dashboardRouteUrl({ kind: 'local', view: snapshot.view ?? { page: 'overview' } }))};</script>`,
    `<script id="dashboard-application" type="module">${escapeInlineScript(
      assets.javascript,
    )}</script></body></html>`,
  ];
  onProgress?.(1);
  return new Blob(parts, { type: 'text/html;charset=utf-8' });
}

export async function downloadStandaloneHtml(
  recording: TraceRecording,
  onProgress?: (progress: number) => void,
  snapshot?: StandaloneSnapshot,
  signal?: AbortSignal,
): Promise<void> {
  const blob = await createStandaloneHtmlBlob(
    recording,
    onProgress,
    undefined,
    snapshot,
  );
  signal?.throwIfAborted();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(recording.sessionId)}-trace-report.html`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function loadDashboardAssets(): Promise<StandaloneDashboardAssets> {
  const currentAssets = await loadAssetsFromCurrentDocument();
  if (currentAssets) {
    return currentAssets;
  }

  // During Vite development the page references TypeScript source modules.
  // Use the latest production build, which Vite exposes below /dist/.
  const builtAssets = await loadAssetsFromHtml(
    new URL('/dist/index.html', document.baseURI),
    true,
  );
  if (builtAssets) {
    return builtAssets;
  }

  const coreAssets = await loadAssetsFromHtml(
    new URL('/dist/dashboard/index.html', document.baseURI),
    true,
  );
  if (coreAssets) {
    return coreAssets;
  }

  throw new Error(
    'Could not package the dashboard application. Build the monitoring viewer and try again.',
  );
}

async function loadAssetsFromCurrentDocument(): Promise<
  StandaloneDashboardAssets | undefined
> {
  const inlineJavascript = document
    .querySelector<HTMLScriptElement>('#dashboard-application')
    ?.textContent?.trim();
  const productionScript = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
  ).find((script) => isProductionAsset(script.src));
  const javascript = inlineJavascript
    ? inlineJavascript
    : productionScript
      ? await fetchText(new URL(productionScript.src, document.baseURI))
      : undefined;
  if (!javascript) {
    return undefined;
  }

  const css = await collectCurrentCss();
  return css ? { css, javascript } : undefined;
}

async function collectCurrentCss(): Promise<string> {
  const inline = Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .filter(Boolean);
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
  );
  const linked = await Promise.all(
    links.map((link) => fetchCssText(new URL(link.href, document.baseURI))),
  );
  return [...inline, ...linked].join('\n');
}

async function loadAssetsFromHtml(
  pageUrl: URL,
  assetsRelativeToPage: boolean,
): Promise<StandaloneDashboardAssets | undefined> {
  let html: string;
  try {
    html = await fetchText(pageUrl);
  } catch {
    return undefined;
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const script = Array.from(
    parsed.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
  ).find((candidate) => isProductionAsset(candidate.getAttribute('src') ?? ''));
  const stylesheets = Array.from(
    parsed.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'),
  );
  if (!script || stylesheets.length === 0) {
    return undefined;
  }
  const resolveAsset = (source: string) =>
    assetsRelativeToPage
      ? new URL(source.replace(/^\/+/, ''), new URL('.', pageUrl))
      : new URL(source, pageUrl);
  const [javascript, cssParts] = await Promise.all([
    fetchText(resolveAsset(script.getAttribute('src')!)),
    Promise.all(
      stylesheets.map((stylesheet) =>
        fetchCssText(resolveAsset(stylesheet.getAttribute('href')!)),
      ),
    ),
  ]);
  return { css: cssParts.join('\n'), javascript };
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load dashboard asset: ${url.pathname}`);
  }
  return response.text();
}

async function fetchCssText(url: URL): Promise<string> {
  const directUrl = new URL(url);
  directUrl.searchParams.set('direct', '');
  const css = await fetchText(directUrl);
  if (
    css.includes('__vite__css') ||
    css.includes('__vite__updateStyle') ||
    /^\s*import\s+\{[^}]*createHotContext/.test(css)
  ) {
    throw new Error(
      `Dashboard stylesheet was returned as JavaScript: ${url.pathname}`,
    );
  }
  return css;
}

function isProductionAsset(source: string): boolean {
  return /(?:^|\/)assets\/[^/]+\.js(?:\?|$)/.test(source);
}

function documentStart(recording: TraceRecording, css: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta name="description" content="Inspect performance trace recordings"><title>Trace dashboard — ${escapeHtml(
    recording.sessionId,
  )}</title><style>${escapeInlineStyle(
    css,
  )}</style></head><body style="margin:0;padding:0"><div id="root" style="margin:0;padding:0"></div><script id="dashboard-snapshot" type="application/json">`;
}

function safeJson(value: unknown): string {
  return (JSON.stringify(value) ?? 'null').replaceAll('<', '\\u003c');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeInlineScript(value: string): string {
  return value.replaceAll(/<\/script/gi, '<\\/script');
}

function escapeInlineStyle(value: string): string {
  return value.replaceAll(/<\/style/gi, '<\\/style');
}

function safeFileName(value: string): string {
  return value.replaceAll(/[^a-z0-9._-]+/gi, '-').slice(0, 80) || 'recording';
}
