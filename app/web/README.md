# @sx/docs — technical presentation and documentation

Static documentation for the tracing approach, recordings, and extensible npm
dashboard. The home page explains the mechanism and workflows; the sidebar leads
to guides, examples, benchmark evidence, package references, and the independent
original libraries. It uses a familiar article/sidebar/table-of-contents layout.

## Develop and build

From the repository root, use the Node version in `.node-version` and Yarn 1:

```sh
yarn install --frozen-lockfile
yarn dev:web
# http://localhost:3000

yarn build:web
# Static HTML, CSS, JS, and .nojekyll in app/web/out/
yarn workspace @sx/docs test
yarn workspace @sx/docs start
# Static preview at http://localhost:4173
```

The build uses Next.js with Nextra and `output: 'export'`. No Node server, API,
database, or runtime rendering is required in deployment. Browser JavaScript adds
topic filtering, the mobile navigation toggle, and client navigation; the articles
are pre-rendered HTML. The topic filter searches navigation titles, not full text.
`start` serves the static output for local inspection, not `next start`.

## GitHub Pages and other subdirectory hosts

Build with the deployment prefix **at build time**, without a trailing slash:

```sh
NEXT_PUBLIC_BASE_PATH=/sx-tracing yarn build:web
NEXT_PUBLIC_BASE_PATH=/sx-tracing yarn workspace @sx/docs test
NEXT_PUBLIC_BASE_PATH=/sx-tracing yarn workspace @sx/docs start
# http://localhost:4173/sx-tracing/
```

Upload the **contents** of `app/web/out/`, including `.nojekyll`, to the site's
root. The host mounts that root at `/sx-tracing/`; do not add another nested
`sx-tracing` directory inside the artifact. For a custom domain or root-hosted
site, omit `NEXT_PUBLIC_BASE_PATH` and rebuild. `trailingSlash: true` generates
`guide/topic/index.html` so a static host can serve deep links and refreshes.

A manually triggered [GitHub Pages workflow](../../.github/workflows/docs-pages.yml)
builds, validates, and deploys the export. In repository **Settings → Pages**, set
the source to **GitHub Actions**, then run **Deploy technical documentation** in
Actions. It uses the repository name as the project-site prefix. For a root-hosted
`owner.github.io` repository or custom domain, change the workflow prefix to an
empty string. Pushing code alone does not trigger this deployment.

See the [Nextra static-export guide](https://nextra.site/docs/guide/static-exports)
and [Next.js static-export documentation](https://nextjs.org/docs/app/guides/static-exports)
for framework constraints.

## One source for GitHub and the website

`lib/guides.mjs` maps repository Markdown files to stable website URLs and sidebar
groups. Before dev/build, `scripts/sync-docs.mjs` generates `content/guide/*.md`.
Those generated files are ignored by Git: edit the original file in `docs/` or
`packages/`, then restart dev or run `yarn workspace @sx/docs sync:docs`.

The generator parses Markdown, rewrites links to included guides as local site
links, and points source files or other repository documents to GitHub. Code
blocks remain code. The generated content is plain Markdown, so TypeScript angle
brackets and prose braces are not interpreted as JSX.

- `content/index.mdx`: authored technical overview.
- `lib/guides.mjs`: curated reading order, source files, and route slugs.
- `content/runtime-context/` and `content/tracer/`: existing standalone library guides.
- `app/docs-shell.tsx`: responsive navigation and topic filtering.
- `app/[[...mdxPath]]/page.tsx`: articles, page contents, source links, and adjacent guides.
- `app/styles.css`: shared reading layout, code, tables, and print styles.

To add a guide, add one manifest entry, regenerate, build, and run the static-site
tests. They check every exported guide and local link/anchor/asset under the chosen
prefix. Also inspect desktop/mobile layouts after changing the shell or styles.
