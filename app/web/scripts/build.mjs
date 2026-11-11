import { readFile, writeFile, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHighlighter } from 'shiki';
import { guides } from '../lib/guides.mjs';
import { documentHtml, renderMarkdown, frontmatter } from './render.mjs';

const started = performance.now();
const root = fileURLToPath(new URL('../../../', import.meta.url));
const web = path.join(root, 'app/web');
const output = path.join(web, 'out');
const base = process.env.SITE_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '';
if (base && !/^\/[a-zA-Z0-9_/-]*[a-zA-Z0-9_-]$/.test(base)) throw new Error('SITE_BASE_PATH must be a URL path with a leading slash and no trailing slash');
const overview = 'app/web/content/index.md';
const pages = [{ route: '/', file: overview, ...frontmatter(await readFile(path.join(root, overview), 'utf8')).metadata }];
for (const [group, slug, title, file] of guides) pages.push({ group, route: `/guide/${slug}/`, title, file });
for (const library of ['runtime-context', 'tracer']) {
  const files = (await readdir(path.join(web, 'content', library), { recursive: true })).filter(file => file.endsWith('.md')).sort();
  // Keep the package introduction first, then its detailed sections.
  files.sort((a, b) => Number(b === 'index.md') - Number(a === 'index.md'));
  for (const name of files) {
    const file = `app/web/content/${library}/${name}`;
    const slug = name.replace(/(?:^|\/)index\.md$/, '').replace(/\.md$/, '');
    const route = `/${library}/${slug ? `${slug}/` : ''}`;
    const metadata = frontmatter(await readFile(path.join(root, file), 'utf8')).metadata;
    pages.push({ group: `Independent: @sx/${library}`, route, file, ...metadata });
  }
}
const routes = new Map(pages.map(page => [page.file, page.route]));
routes.set('README.md', '/');
routes.set('docs/README.md', '/');
const highlighter = await createHighlighter({ themes: ['github-light'], langs: ['typescript', 'tsx', 'javascript', 'json', 'bash', 'yaml', 'html', 'css', 'python'] });
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
const assets = {};
for (const extension of ['css', 'js']) {
  const content = await readFile(path.join(web, 'assets', `site.${extension}`));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 10);
  assets[extension] = `/assets/site.${hash}.${extension}`;
  await writeFile(path.join(output, assets[extension]), content);
}
for (const page of pages) {
  const source = await readFile(path.join(root, page.file), 'utf8');
  const rendered = await renderMarkdown(source, { file: page.file, routes, base, highlighter });
  const destination = path.join(output, page.route, 'index.html');
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, documentHtml({ page, ...rendered, pages, base, assets }));
}
await writeFile(path.join(output, '404.html'), documentHtml({ page: { route: '/404/', title: 'Page not found' }, html: `<h1>Page not found</h1><p>The address may have changed. <a href="${base}/">Open the overview</a> or choose a guide from the navigation.</p>`, toc: [], pages, base, assets }));
await writeFile(path.join(output, '.nojekyll'), '');
await copyFile(path.join(web, 'assets/icon.svg'), path.join(output, 'icon.svg'));
highlighter.dispose();
console.log(`Built ${pages.length} HTML pages in ${((performance.now() - started) / 1000).toFixed(2)}s. Output: app/web/out${base ? ` (prefix ${base})` : ''}`);
