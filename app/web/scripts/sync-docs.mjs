import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { guides } from '../lib/guides.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const destination = path.join(root, 'app/web/content/guide');
const routes = new Map(guides.map(([, slug, , file]) => [file, `/guide/${slug}/`]));
routes.set('README.md', '/');
routes.set('docs/README.md', '/');
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkStringify);
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const [, slug, title, file] of guides) {
  const tree = processor.parse(await readFile(path.join(root, file), 'utf8'));
  function visit(node) {
    if (node.url && !/^(?:[a-z]+:|\/\/|#)/i.test(node.url)) {
      const [target, fragment] = node.url.split('#');
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
      const route = routes.get(resolved);
      node.url = (route ?? `https://github.com/tuchk4/sx-tracing/blob/main/${resolved}`) + (fragment ? `#${fragment}` : '');
    }
    node.children?.forEach(visit);
  }
  visit(tree);
  await writeFile(path.join(destination, `${slug}.md`), `---\ntitle: ${JSON.stringify(title)}\n---\n\n${processor.stringify(tree)}`);
}
await writeFile(path.join(destination, '_meta.ts'), `export default ${JSON.stringify(Object.fromEntries(guides.map(([, slug, title]) => [slug, title])), null, 2)};\n`);
console.log(`Synced ${guides.length} guides from repository Markdown.`);
