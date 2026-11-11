# Workspace integration

Source: production tracing implementation imported 2026-11-11. The original
archive and reference snapshot stay local and are excluded from Git; the adapted
implementation and its regression tests live in `packages/`.

Plan: integrate tracing runtime, extract recording sessions/transport, integrate dashboard; install dependencies, run regression tests, typecheck and verify npm artifacts.

Decisions: preserve the capture runtime in tracing to avoid circular dependencies; recordings re-exports tracing for the original combined API. Preserve legacy tracer/runtime-context packages. Use the existing Yarn 1 workspace. Adapt Vite configuration to the public Vite 7 toolchain. No commits or publishing.

Progress: packages copied; imports, manifests and test configuration adapted.

## Validation and compatibility

- Dependencies installed with Yarn 1 on Node 24.11.1; `.node-version` retains the supported Node 22.16 baseline.
- Full package build and workspace typecheck passed.
- Imported tests exercise the cross-package session/server flow without platform-specific adapters.
- `yarn test:packages` packs and installs all three packages into a temporary consumer without React peers, then checks Node16 ESM/CommonJS declarations, shared runtime state, the dashboard CLI and bundled assets, and upload/readback.
- Consumer CommonJS type resolution initially failed with TS1479. Conditional declaration exports and `.d.cts` files fix the reproduced failure.
- Dashboard declaration generation needed an explicit `ReactPortal | null` return type because the workspace also contains React 19 documentation dependencies.
- Vite 7 uses Rollup's native CommonJS handling of `import.meta.url`; the source's Rolldown-specific define was removed.
- The npm package supplies `dashboard`, `trace-dashboard`, and `trace-performance-report` commands. No packages were published.

The imported platform adapter and monitoring application remain reference examples; the generic recorder and dashboard have no dependencies on their private services. The proposed new `startTracing` API is not part of this source-preserving integration; use `recordSession` and `releaseSession`.

## Review

A separate read-only review checked package boundaries and npm readiness. Its CommonJS declaration finding was reproduced with a `.cts` consumer and fixed; the artifact check now covers it. A concurrent regression run hit two 10-second test timeouts, so the integrated Vitest configuration limits execution to two workers without extending the original timeouts.

Completion: all 191 tests passed with two workers; workspace typecheck, full builds, and isolated npm artifact checks passed.
