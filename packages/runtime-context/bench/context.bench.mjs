import { AsyncLocalStorage } from "node:async_hooks";
import { Bench } from "tinybench";
import { capture, createContext } from "../dist/index.js";

// =============================================================
// Setup — a request env shared across three "providers":
//   - @sx/runtime-context (the thing we're benchmarking)
//   - AsyncLocalStorage (Node's built-in, the closest comparable)
//   - a plain module-level global (cheapest possible read)
// =============================================================

const RequestCtx = createContext();
const LoggerCtx = createContext();
const TenantCtx = createContext();

const requestALS = new AsyncLocalStorage();
const loggerALS = new AsyncLocalStorage();
const tenantALS = new AsyncLocalStorage();

let globalRequestEnv = null;

let sink = 0;

// =============================================================
// Workloads — each tier paired across the three approaches.
// =============================================================

// --- read-cost: 100 reads of the same value ---
function readCtxHot(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += RequestCtx.get().userId.length;
  sink = (sink + total) | 0;
}
function readALSHot(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += requestALS.getStore().userId.length;
  sink = (sink + total) | 0;
}
function readGlobalHot(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += globalRequestEnv.userId.length;
  sink = (sink + total) | 0;
}

// --- handler shape: 10 inner fn calls, each reads the env once ---
function stepCtx(label) {
  const env = RequestCtx.get();
  sink = (sink + env.userId.length + label) | 0;
}
function stepALS(label) {
  const env = requestALS.getStore();
  sink = (sink + env.userId.length + label) | 0;
}
function stepGlobal(label) {
  const env = globalRequestEnv;
  sink = (sink + env.userId.length + label) | 0;
}
function ctxHandler() {
  stepCtx(1); stepCtx(2); stepCtx(3); stepCtx(4); stepCtx(5);
  stepCtx(6); stepCtx(7); stepCtx(8); stepCtx(9); stepCtx(10);
}
function alsHandler() {
  stepALS(1); stepALS(2); stepALS(3); stepALS(4); stepALS(5);
  stepALS(6); stepALS(7); stepALS(8); stepALS(9); stepALS(10);
}
function globalHandler() {
  stepGlobal(1); stepGlobal(2); stepGlobal(3); stepGlobal(4); stepGlobal(5);
  stepGlobal(6); stepGlobal(7); stepGlobal(8); stepGlobal(9); stepGlobal(10);
}

// --- async handler: 3 awaits, 4 reads ---
async function asyncCtxHandler() {
  stepCtx(1);
  await Promise.resolve();
  stepCtx(2);
  await Promise.resolve();
  stepCtx(3);
  await Promise.resolve();
  stepCtx(4);
}
async function asyncALSHandler() {
  stepALS(1);
  await Promise.resolve();
  stepALS(2);
  await Promise.resolve();
  stepALS(3);
  await Promise.resolve();
  stepALS(4);
}
async function asyncGlobalHandler() {
  stepGlobal(1);
  await Promise.resolve();
  stepGlobal(2);
  await Promise.resolve();
  stepGlobal(3);
  await Promise.resolve();
  stepGlobal(4);
}

// --- best-practice variant: read once at top, pass via local ---
async function asyncCtxHandlerLocal() {
  const env = RequestCtx.get();          // one read
  sink = (sink + env.userId.length) | 0;
  await Promise.resolve();
  sink = (sink + env.userId.length) | 0; // local, no walk
  await Promise.resolve();
  sink = (sink + env.userId.length) | 0;
  await Promise.resolve();
  sink = (sink + env.userId.length) | 0;
}
async function asyncALSHandlerLocal() {
  const env = requestALS.getStore();
  sink = (sink + env.userId.length) | 0;
  await Promise.resolve();
  sink = (sink + env.userId.length) | 0;
  await Promise.resolve();
  sink = (sink + env.userId.length) | 0;
  await Promise.resolve();
  sink = (sink + env.userId.length) | 0;
}

// --- multi-context: 3 stores active at once ---
function multiCtx() {
  const r = RequestCtx.get();
  const l = LoggerCtx.get();
  const t = TenantCtx.get();
  sink = (sink + r.userId.length + l.level.length + t.id) | 0;
}
function multiALS() {
  const r = requestALS.getStore();
  const l = loggerALS.getStore();
  const t = tenantALS.getStore();
  sink = (sink + r.userId.length + l.level.length + t.id) | 0;
}
function multiCtxHandler() {
  multiCtx(); multiCtx(); multiCtx(); multiCtx(); multiCtx();
}
function multiALSHandler() {
  multiALS(); multiALS(); multiALS(); multiALS(); multiALS();
}

// --- shared fixture values ---
const ENV = { userId: "u-bench", traceId: "t" };
const LOG = { level: "info" };
const TENANT = { id: 1 };

// =============================================================
// Benchmarks
// =============================================================

const bench = new Bench({ time: 1000, warmup: true, warmupTime: 250 });

bench
  // ─────────── hot-read: 100 reads of same value ───────────
  .add("hot read x100: @sx/runtime-context", () => {
    RequestCtx.provider(ENV).run(() => readCtxHot(100));
  })
  .add("hot read x100: AsyncLocalStorage", () => {
    requestALS.run(ENV, () => readALSHot(100));
  })
  .add("hot read x100: global (baseline)", () => {
    globalRequestEnv = ENV;
    readGlobalHot(100);
  })

  // ─────────── handler shape: 10 fn × 1 read ───────────
  .add("handler 10x1: @sx/runtime-context", () => {
    RequestCtx.provider(ENV).run(() => ctxHandler());
  })
  .add("handler 10x1: AsyncLocalStorage", () => {
    requestALS.run(ENV, () => alsHandler());
  })
  .add("handler 10x1: global (baseline)", () => {
    globalRequestEnv = ENV;
    globalHandler();
  })

  // ─────────── multi-context: 3 stores × 5 reads ───────────
  .add("multi 3ctx × 5 reads: @sx/runtime-context", () => {
    RequestCtx.provider(ENV).run(() => {
      LoggerCtx.provider(LOG).run(() => {
        TenantCtx.provider(TENANT).run(() => multiCtxHandler());
      });
    });
  })
  .add("multi 3ctx × 5 reads: AsyncLocalStorage", () => {
    requestALS.run(ENV, () => {
      loggerALS.run(LOG, () => {
        tenantALS.run(TENANT, () => multiALSHandler());
      });
    });
  })

  // ─────────── scope setup: empty run ───────────
  .add("provider().run(noop): @sx/runtime-context", () => {
    RequestCtx.provider(ENV).run(() => {});
  })
  .add("als.run(noop): AsyncLocalStorage", () => {
    requestALS.run(ENV, () => {});
  })

  // ─────────── async: 3 awaits with 4 reads ───────────
  .add("async 3 awaits 4 reads: @sx/runtime-context", async () => {
    await RequestCtx.provider(ENV).run(() => asyncCtxHandler());
  })
  .add("async 3 awaits 4 reads: AsyncLocalStorage", async () => {
    await requestALS.run(ENV, () => asyncALSHandler());
  })
  .add("async 3 awaits 4 reads: global (baseline)", async () => {
    globalRequestEnv = ENV;
    await asyncGlobalHandler();
  })

  // ─────────── async best-practice: read once at top, locals after ───────────
  .add("async 3 awaits, capture-local: @sx/runtime-context", async () => {
    await RequestCtx.provider(ENV).run(() => asyncCtxHandlerLocal());
  })
  .add("async 3 awaits, capture-local: AsyncLocalStorage", async () => {
    await requestALS.run(ENV, () => asyncALSHandlerLocal());
  });

await bench.run();

// =============================================================
// Output
// =============================================================

const rows = bench.table((task) => {
  const meanNs = (task.result?.latency.mean ?? 0) * 1_000_000;
  const hz = task.result?.throughput.mean ?? 0;
  return {
    Task: task.name,
    "ops/sec": Math.round(hz).toLocaleString("en-US"),
    "mean ns": Math.round(meanNs).toLocaleString("en-US"),
  };
});

console.log("\n@sx/runtime-context vs AsyncLocalStorage — realistic workloads\n");
console.table(rows);

if (sink === Number.MIN_SAFE_INTEGER) {
  console.log("avoid DCE", sink);
}
