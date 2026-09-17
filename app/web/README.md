# @sx/docs

Documentation site for [`@sx/runtime-context`](../../packages/runtime-context) and
[`@sx/tracer`](../../packages/tracer), built with [Nextra 4](https://nextra.site) on Next.js.

## Run it

From the repo root:

```bash
yarn install
yarn dev:web       # http://localhost:3000
yarn build:web     # production build
```

Or from this directory: `yarn dev`, `yarn build`, `yarn start`, `yarn typecheck`.

## Layout

```
app/                    Next.js app router shell (catch-all MDX route, theme, styles)
content/                the docs themselves — MDX + `_meta.ts` nav definitions
├── index.mdx           landing page
├── runtime-context/    getting-started · guides · api · examples · reference
└── tracer/             getting-started · guides · api · examples · reference
mdx-components.tsx      MDX component overrides
next.config.mjs         Nextra config (`contentDirBasePath: "/"`)
```

## Editing docs

Pages are plain MDX under `content/` — the file path is the URL. Sidebar order and titles come
from the `_meta.ts` file in each directory; add an entry there when you add a page, otherwise it
falls to the bottom of the nav with a title derived from the filename.

Keep prose consistent with the package READMEs: the same caveats (V8 stack-format dependency,
fire-and-forget async, "not OpenTelemetry") should be stated the same way in both places.
