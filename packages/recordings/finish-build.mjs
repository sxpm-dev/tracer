import { readdir, readFile, writeFile, chmod } from 'node:fs/promises';
async function rewrite(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await rewrite(path);
    else if (entry.name.endsWith('.d.ts')) {
      const source = (await readFile(path, 'utf8')).replace(
        /(from ['"]|import\(['"])(\.[^'"]+)(['"])/g,
        (_, before, specifier, after) =>
          `${before}${specifier.endsWith('.js') ? specifier : `${specifier}.js`}${after}`,
      );
      await writeFile(path, source);
      await writeFile(
        path.replace(/\.d\.ts$/, '.d.cts'),
        source.replace(/(from ['"]|import\(['"])(\.[^'"]+)\.js(['"])/g, '$1$2.cjs$3'),
      );
    }
  }
}
await rewrite('dist/types');
