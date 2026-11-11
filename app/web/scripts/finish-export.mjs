import { writeFile } from 'node:fs/promises';
await writeFile(new URL('../out/.nojekyll', import.meta.url), '');
console.log('Static website ready in app/web/out (including .nojekyll).');
