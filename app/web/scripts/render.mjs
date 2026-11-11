import { toHtml } from 'hast-util-to-html';
import GithubSlugger from 'github-slugger';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import path from 'node:path';

export const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const plain = node => node.value ?? (node.children ?? []).map(plain).join('');
export function frontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const metadata = {};
  for (const line of (match?.[1] || '').split('\n')) {
    const field = line.match(/^(title|description):\s*(.*)$/);
    if (field) metadata[field[1]] = field[2].replace(/^"|"$/g, '');
  }
  return { metadata, body: match ? source.slice(match[0].length) : source };
}

export async function renderMarkdown(source, { file, routes, base, highlighter }) {
  const { body } = frontmatter(source);
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const markdown = processor.parse(body);
  function links(node) {
    if (node.url && !/^(?:[a-z]+:|\/\/|#)/i.test(node.url)) {
      const [target, hash] = node.url.split('#');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      let url = target.startsWith('/') ? target : routes.get(resolved);
      if (url) {
        if (!path.posix.extname(url) && !url.endsWith('/')) url += '/';
        node.url = base + url;
      } else node.url = `https://github.com/tuchk4/sx-tracing/blob/main/${resolved}`;
      if (hash) node.url += `#${hash}`;
    }
    node.children?.forEach(links);
  }
  links(markdown);
  const html = await processor.run(markdown);
  const slugger = new GithubSlugger();
  const toc = [];
  function decorate(node) {
    if (node.type === 'element' && /^h[1-6]$/.test(node.tagName)) {
      const text = plain(node);
      node.properties.id = slugger.slug(text);
      if (node.tagName === 'h2') toc.push({ title: text, id: node.properties.id });
    }
    if (node.type === 'element' && node.tagName === 'pre') {
      const code = node.children.find(child => child.tagName === 'code');
      const requested = code?.properties?.className?.find(name => name.startsWith('language-'))?.slice(9) || 'text';
      const lang = highlighter.getLoadedLanguages().includes(requested) ? requested : 'text';
      const value = plain(code || node).replace(/\n$/, '');
      const rendered = highlighter.codeToHast(value, { lang, theme: 'github-light' });
      const pre = rendered.children[0];
      pre.properties.tabIndex = 0;
      pre.properties.ariaLabel = `${requested} code example`;
      Object.assign(node, pre);
      return;
    }
    node.children?.forEach(decorate);
  }
  decorate(html);
  return { html: toHtml(html), toc };
}

export function documentHtml({ page, html, toc, pages, base, assets }) {
  const href = route => escape(base + route);
  const link = (route, title) => `<a href="${href(route)}"${page.route === route ? ' aria-current="page"' : ''}>${escape(title)}</a>`;
  const groups = [...new Set(pages.map(p => p.group).filter(Boolean))];
  const nav = groups.map(group => `<section class="sx-nav-group" data-nav-group><h2>${escape(group)}</h2><ul>${pages.filter(p => p.group === group).map(p => `<li>${link(p.route, p.title)}</li>`).join('')}</ul></section>`).join('');
  const index = pages.findIndex(p => p.route === page.route);
  const adjacent = direction => {
    const next = pages[index + direction];
    return next && index >= 0 ? `<a href="${href(next.route)}"><span>${direction < 0 ? 'Previous' : 'Next'}</span>${escape(next.title)}</a>` : '<span></span>';
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(page.title)} | sx-tracing</title><meta name="description" content="${escape(page.description || 'JavaScript tracing: runtime mechanisms, recording workflows, examples, and reference.')}" />
<link rel="icon" href="${href('/icon.svg')}" type="image/svg+xml"><link rel="stylesheet" href="${href(assets.css)}"><script src="${href(assets.js)}" defer></script></head>
<body><a class="sx-skip" href="#main-content">Skip to content</a>
<header class="sx-topbar"><a class="sx-logo" href="${href('/')}" aria-label="sx-tracing overview"><svg width="25" height="25" viewBox="0 0 25 25" aria-hidden="true"><path d="M5 4v17M5 8h9v6h6M5 18h9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="14" r="2" fill="currentColor"/></svg>sx-tracing</a><span class="sx-topbar-description">JavaScript runtime tracing</span><a class="sx-repository" href="https://github.com/tuchk4/sx-tracing">GitHub</a></header>
<div class="sx-shell"><aside class="sx-sidebar" aria-label="Documentation navigation"><details class="sx-navigation-panel" open><summary>Browse documentation</summary><nav id="site-navigation"><div class="sx-filter" hidden><label for="filter-guides">Find a topic</label><input id="filter-guides" type="search" placeholder="Filter topics…" autocomplete="off"></div>${link('/', 'Overview')}${nav}<p id="filter-empty" role="status" hidden>No matching topics. Try “stack”, “cache”, or “dashboard”.</p></nav></details></aside>
<main id="main-content" class="sx-content" tabindex="-1"><div class="sx-article-layout"><article class="sx-article">${html}
${page.file ? `<div class="sx-article-source"><a href="https://github.com/tuchk4/sx-tracing/blob/main/${escape(page.file)}">Edit this page on GitHub</a></div>` : ''}
${index >= 0 ? `<nav class="sx-pagination" aria-label="Adjacent guides">${adjacent(-1)}${adjacent(1)}</nav>` : ''}</article>
${toc.length ? `<aside class="sx-toc" aria-label="On this page"><p>On this page</p><ul>${toc.map(item => `<li><a href="#${escape(item.id)}">${escape(item.title)}</a></li>`).join('')}</ul></aside>` : ''}</div></main></div>
<footer class="sx-footer"><span>sx-tracing · MIT</span><a href="https://github.com/tuchk4/sx-tracing/tree/main/docs">Markdown documentation</a></footer></body></html>`;
}
