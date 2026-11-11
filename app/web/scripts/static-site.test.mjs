import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { guides } from '../lib/guides.mjs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

const output = fileURLToPath(new URL('../out/', import.meta.url));
const base = process.env.SITE_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const files = (await readdir(output, { recursive: true })).filter(file => file.endsWith('.html'));
const pages = new Map();
for (const file of files) pages.set(file, new JSDOM(await readFile(path.join(output, file), 'utf8')).window.document);

test('every guide exports readable HTML with its title and navigation', () => {
  for (const [, slug, title] of guides) {
    const document = pages.get(`guide/${slug}/index.html`);
    assert.ok(document, `Missing export: ${slug}`);
    assert.ok(document.querySelector('h1')?.textContent, `Missing heading: ${slug}`);
    assert.ok(document.title.includes(title), `Missing metadata title: ${slug}`);
    assert.ok(document.querySelector('nav[aria-label="On this page"], aside[aria-label="On this page"]'));
    assert.ok(document.querySelector('#main-content'));
  }
});

test('local links and assets resolve under the configured deployment prefix', async () => {
  const failures = [];
  for (const [file, document] of pages) {
    const pageUrl = new URL(`${base}/${file.replace(/index\.html$/, '')}`, 'https://docs.test');
    for (const element of document.querySelectorAll('a[href], script[src], link[href], img[src]')) {
      const href = element.getAttribute('href') ?? element.getAttribute('src');
      const url = new URL(href, pageUrl);
      if (url.origin !== pageUrl.origin) continue;
      if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
        failures.push(`${file}: outside base path: ${href}`); continue;
      }
      let target = decodeURIComponent(url.pathname.slice(base.length)).replace(/^\//, '');
      if (!target || target.endsWith('/')) target += 'index.html';
      else if (!path.extname(target)) target += '/index.html';
      try { await access(path.join(output, target)); }
      catch { failures.push(`${file}: missing ${href}`); }
      if (url.hash && pages.has(target)) {
        const id = decodeURIComponent(url.hash.slice(1));
        if (!pages.get(target).getElementById(id)) failures.push(`${file}: missing anchor ${href}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('overview describes the mechanism and consumers without a marketing hero', () => {
  const doc = pages.get('index.html');
  assert.ok(doc.querySelector('h1').textContent.includes('Stack-based tracing'));
  assert.ok(doc.querySelector('article').textContent.includes('does not throw it'));
  assert.ok(!doc.querySelector('[class*="landing"]'));
});

test('GitHub Pages artifact includes .nojekyll and a 404 page', async () => {
  await access(path.join(output, '.nojekyll'));
  await access(path.join(output, '404.html'));
});


test('preview server serves root, deep links, assets, and missing-page responses', async () => {
  const server = spawn(process.execPath, [fileURLToPath(new URL('./serve-export.mjs', import.meta.url))], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Preview did not start')), 5000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.stdout.once('data', data => { clearTimeout(timer); resolve(data.toString().trim().replace('Static preview: ', '')); });
    });
    for (const page of ['', 'guide/how-tracing-works/', 'icon.svg']) {
      const response = await fetch(new URL(page, url));
      assert.equal(response.status, 200, page || 'root');
      if (!page) assert.ok((await response.text()).includes('Stack-based tracing'));
    }
    assert.equal((await fetch(new URL('missing-page/', url))).status, 404);
  } finally {
    server.kill();
  }
});


test('generated guides preserve every source code example', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const parser = unified().use(remarkParse);
  const code = text => {
    const blocks = [];
    function visit(node) {
      if (node.type === 'code') blocks.push({ lang: node.lang, value: node.value });
      node.children?.forEach(visit);
    }
    visit(parser.parse(text));
    return blocks;
  };
  for (const [, slug, , file] of guides) {
    const source = await readFile(path.join(root, file), 'utf8');
    const rendered = [...pages.get(`guide/${slug}/index.html`).querySelectorAll('pre code')].map(node => node.textContent);
    assert.deepEqual(rendered, code(source).map(block => block.value), `Code changed in ${slug}`);
  }
});


test('pages ship one small enhancement script, with no framework runtime', async () => {
  for (const document of pages.values()) {
    const scripts = [...document.querySelectorAll('script')];
    assert.equal(scripts.length, 1);
    assert.ok(scripts[0].defer);
    assert.ok(!document.documentElement.innerHTML.includes('/_next/'));
    assert.ok(document.querySelector('.sx-navigation-panel[open]'), 'Navigation is available without JavaScript');
  }
  const script = pages.get('index.html').querySelector('script').src.slice(base.length);
  assert.ok((await readFile(path.join(output, script))).length < 6000);
});

test('topic filter handles matches and empty results, and mobile navigation is native', async () => {
  const dom = new JSDOM(await readFile(path.join(output, 'index.html'), 'utf8'), { runScripts: 'outside-only' });
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {} });
  dom.window.eval(await readFile(new URL('../assets/site.js', import.meta.url), 'utf8'));
  const doc = dom.window.document;
  assert.equal(doc.querySelector('.sx-navigation-panel').open, false);
  const input = doc.querySelector('#filter-guides');
  input.value = 'unmatched-topic';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelector('#filter-empty').hidden, false);
  input.value = 'stack';
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(doc.querySelector('#filter-empty').hidden, true);
  assert.ok([...doc.querySelectorAll('[data-nav-group] li')].some(item => !item.hidden && item.textContent.includes('Error.stack')));
  dom.window.close();
});
