# @sx/docs — static technical documentation

A Markdown-to-HTML website for tracing, recordings, and the extensible dashboard.
It uses an article/sidebar/table-of-contents layout and preserves the existing
website URLs. Next.js, Nextra, React, and MDX are not website dependencies.

## Develop and build

From the repository root, use the Node version in `.node-version` and Yarn 1:

```sh
yarn install --frozen-lockfile
yarn dev:web
# Builds, serves http://localhost:4173, and rebuilds on source changes.
# Refresh the browser after a rebuild.

yarn build:web
# Writes app/web/out/: HTML, CSS, one small script, icon, and .nojekyll.
yarn workspace @sx/docs test
yarn workspace @sx/docs start
# Serves the existing build at http://localhost:4173.
```

Only the build requires Node. The output needs no server runtime, database, external
font service, or framework router. Articles, syntax highlighting, table-of-contents
links, and navigation are generated HTML. Without JavaScript the navigation stays
expanded and the native mobile disclosure remains usable. One optional script adds
topic-title filtering and initially collapses navigation on small screens.

## GitHub Pages

Set the deployment prefix at build time, without a trailing slash:

```sh
SITE_BASE_PATH=/sx-tracing yarn build:web
SITE_BASE_PATH=/sx-tracing yarn workspace @sx/docs test
SITE_BASE_PATH=/sx-tracing yarn workspace @sx/docs start
# http://localhost:4173/sx-tracing/
```

`NEXT_PUBLIC_BASE_PATH` remains accepted for existing automation; prefer
`SITE_BASE_PATH`. For a custom domain or root-hosted site, omit both and rebuild.

Upload the **contents** of `app/web/out/`, including `.nojekyll`. The host mounts
that root at `/sx-tracing/`; do not nest another `sx-tracing` directory inside the
artifact. Every route has an `index.html` for direct navigation and refreshes.
CSS and JavaScript filenames include content hashes for cache invalidation.

The manual [GitHub Pages workflow](../../.github/workflows/docs-pages.yml) builds,
checks, and deploys this directory. Set **Settings → Pages → Source** to **GitHub
Actions**, then run **Deploy technical documentation** in Actions. Pushing code
does not automatically deploy. The workflow uses the repository name as the prefix;
use an empty prefix for a custom domain or `owner.github.io` root site.

## Edit the content

`lib/guides.mjs` maps repository Markdown files to guide URLs and navigation groups.
The build reads those files directly. Edit `docs/` or the package README rather than
maintaining a website copy. The standalone library pages and overview live in
`content/` as plain Markdown. Code fences are highlighted at build time with Shiki.

Links to included Markdown pages become local website links. Links to source files
and documents outside the site point to GitHub. The build treats content as
Markdown, not JSX; raw HTML is not rendered. Use Markdown tables, lists, and code
blocks for new content. All existing standalone library URLs remain available.

- `content/index.md`: technical overview.
- `lib/guides.mjs`: guide source files, labels, and reading order.
- `scripts/build.mjs`: page discovery, asset hashing, and output generation.
- `scripts/render.mjs`: Markdown rendering, link resolution, and HTML layout.
- `assets/site.css`: shared typography, reading layout, and responsive styles.
- `assets/site.js`: progressive navigation enhancements.
- `scripts/static-site.test.mjs`: exported links/assets, code fidelity, native
  navigation fallback, filtering, preview HTTP responses, and script-size budget.

## Size comparison

Measured on this checkout during the 2026-11-11 replacement, using the overview's
HTML and all directly referenced JavaScript files. Gzip sizes use Node's
`gzipSync` defaults; they are artifact sizes, not network measurements.

| Artifact | Previous framework build | Static HTML build |
| --- | ---: | ---: |
| Overview HTML | 68,230 bytes | 17,937 bytes |
| JavaScript requests | 8 | 1 |
| JavaScript, uncompressed | 591,815 bytes | 1,162 bytes |
| JavaScript, gzip | 183,950 bytes | 518 bytes |

The local build command took about 18 seconds before and 2 seconds after. Build
timings vary with the machine and cache state. These results do not establish
Core Web Vitals or loading performance on users' devices.
