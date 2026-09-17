# @sx — runtime instrumentation primitives

Two small, focused packages for propagating ambient state and recording call trees in JavaScript — without patching `Promise`, without `AsyncLocalStorage`, and without re-rendering.

## Packages

| Package | Description |
|---|---|
| [`@sx/runtime-context`](./packages/runtime-context) | `React.createContext` for plain JS. Store-only, survives `await`, no re-rendering. Faster than `AsyncLocalStorage` on sync paths; competitive when you read once at the top of an async function. **Works in browsers, edge runtimes, and Node.** |
| [`@sx/tracer`](./packages/tracer) | Tiny scope-based tracer. Wraps functions to record a call tree, captures inline markers, gets out of the way when no scope is active. Useful for dev debugging and lightweight observability. |

Both packages share a single technique for propagating identity across `await` boundaries: a pool of pre-built async wrappers whose names encode a slot id (`__sx_ctx__N`, `__sx_trace__N`), so a fresh `Error().stack` can recover the active scope after a continuation resumes. The code is not shared between packages — each carries only the lines it needs — but the trick is the same.

## Documentation

Full docs live in this repo and are published as a Nextra site:

- **Source:** [`app/web/content`](./app/web/content) — MDX, one section per package (getting started, guides, API reference, examples, caveats).
- **Run locally:** `yarn dev:web` (http://localhost:3000), `yarn build:web` for a production build.
- **Per-package READMEs:** [`@sx/runtime-context`](./packages/runtime-context/README.md), [`@sx/tracer`](./packages/tracer/README.md).
- **Changelogs:** [`runtime-context`](./packages/runtime-context/CHANGELOG.md), [`tracer`](./packages/tracer/CHANGELOG.md).

## When to pick what

**Reach for `@sx/runtime-context`** when you need ambient state with the React Context mental model but outside React:
- request-scoped values (user id, trace id, locale) in browser SSR, edge runtimes (Cloudflare Workers, Vercel Edge), or anywhere `AsyncLocalStorage` doesn't ship
- as a faster sync-path alternative to `AsyncLocalStorage` in Node (it beats ALS by 1.3-1.7× on sync reads in our benches)

**Reach for `@sx/tracer`** when you want a quick, low-ceremony look at what your code did:
- ad-hoc call tree of a specific operation during development
- educational/inspection use cases where OpenTelemetry is overkill
- a lightweight event bus you can subscribe to and forward elsewhere

If you need production-grade distributed tracing (spans, contexts, propagation across services), use OpenTelemetry instead. `@sx/tracer` is deliberately scoped smaller.

## Development

```bash
yarn install
yarn build           # build both packages
yarn test            # run both test suites (52 tests)
yarn typecheck       # typecheck both
yarn bench           # run both benchmark suites
yarn bench:tracer    # just the tracer benchmarks
yarn bench:context   # just the runtime-context benchmarks
```

Docs site:

```bash
yarn dev:web         # Nextra docs at http://localhost:3000
yarn build:web       # production build of the docs site
```

LLM token benchmark (optional, calls paid APIs):

```bash
yarn bench:llm-token:fixture                      # generate a synthetic fixture under ./tmp
yarn bench:llm-token --json ./tmp/llm-token-fixture/big-dataset.json \
  --token ./tmp/llm-token-fixture/big-dataset-token.png \
  --question-file ./tmp/llm-token-fixture/question.txt \
  --providers openai,anthropic
```

Requires `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the environment (override models with
`OPENAI_MODEL` / `ANTHROPIC_MODEL`). Output lands in `./tmp/llm-token-benchmark`, which is gitignored.

Each package can be operated on individually:

```bash
yarn workspace @sx/runtime-context test
yarn workspace @sx/tracer test
```

## Layout

```
app/
└── web/                                   # @sx/docs — Nextra documentation site
    ├── app/                               (Next.js app router shell)
    └── content/                           (MDX docs for both packages)
scripts/
├── generate-llm-token-fixture.mjs         (synthetic dataset + PNG token fixture)
└── llm-token-benchmark.mjs                (JSON vs. PNG-token prompt benchmark)
packages/
├── runtime-context/                       # @sx/runtime-context
│   ├── src/index.ts
│   ├── test/runtime-context.test.ts       (26 tests)
│   ├── bench/context.bench.mjs            (vs. AsyncLocalStorage + global)
│   ├── examples/                          (request context, concurrent scopes)
│   ├── README.md
│   ├── CHANGELOG.md
│   └── LICENSE
└── tracer/                                # @sx/tracer
    ├── src/index.ts
    ├── test/tracer.test.ts                (26 tests)
    ├── bench/tracer.bench.mjs
    ├── examples/                          (class decorator, async + step, telemetry forwarder)
    ├── README.md
    ├── CHANGELOG.md
    └── LICENSE
```

## Caveats worth knowing up front

- **V8 stack-format dependency.** Async recovery (cross-`await` `get()` / post-await `marker()`) depends on `Error.stack` printing named asynchronous frames. This is reliable on V8 (Chrome, Node 12+, Edge, Bun, Deno). On Firefox/Safari, sync usage is portable but cross-`await` recovery is engine-dependent.
- **Fire-and-forget async doesn't propagate.** If you don't return your promise from the `.run` callback (or wrap the call in `trace`), the package can't anchor anything to it. Same structural limitation `AsyncLocalStorage` has if you forget to call `.run` on it.
- **`@sx/tracer` is not OpenTelemetry.** Don't ship it as a replacement for distributed tracing. It records sample-scoped call trees and emits events you can forward.

## License

MIT.
