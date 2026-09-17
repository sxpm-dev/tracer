import { Bench } from "tinybench";
import { marker, trace } from "../dist/index.js";

let sink = 0;

function makePlainChain(depth) {
  const chain = [];

  for (let index = 0; index < depth; index += 1) {
    chain[index] = function step() {
      sink += index;
      return chain[index + 1]?.() ?? sink;
    };
  }

  return chain[0];
}

function makeTracedChain(depth, options) {
  const chain = [];

  for (let index = 0; index < depth; index += 1) {
    chain[index] = trace(
      function step() {
        sink += index;
        return chain[index + 1]?.() ?? sink;
      },
      { name: `step${index}`, ...options },
    );
  }

  return chain[0];
}

function makeTracedMarkerChain(depth) {
  const chain = [];

  for (let index = 0; index < depth; index += 1) {
    chain[index] = trace(function step() {
      marker("hit");
      sink += index;
      return chain[index + 1]?.() ?? sink;
    }, { name: `step${index}` });
  }

  return chain[0];
}

function makeNamedFrameCaller() {
  const frameName = "__sx_trace__bench__step";
  const holder = {
    [frameName]() {
      sink += 1;
      return sink;
    },
  };

  return () => holder[frameName]();
}

function callNewNamedFrame() {
  const frameName = "__sx_trace__bench__step";
  const holder = {
    [frameName]() {
      sink += 1;
      return sink;
    },
  };

  return holder[frameName]();
}

function makePlainClosure() {
  return function plainClosure() {
    return new Error();
  };
}

function makeClosureWithNewErrorHolder() {
  const creationTrace = new Error();

  return function h____newError() {
    const error = new Error();
    error.creationTrace = creationTrace;
    return error;
  };
}

function makeClosureWithCaptureStackTraceHolder() {
  const creationTrace = {};
  Error.captureStackTrace?.(creationTrace, makeClosureWithCaptureStackTraceHolder);

  return function h____captureStackTrace() {
    const error = new Error();
    error.creationTrace = creationTrace;
    return error;
  };
}

const depth = Number.parseInt(process.env.TRACER_BENCH_DEPTH ?? "10", 10);
const time = Number.parseInt(process.env.TRACER_BENCH_TIME ?? "1000", 10);
const bench = new Bench({ time, warmup: true, warmupTime: 250 });

const plain = makePlainChain(depth);
const traced = makeTracedChain(depth);
const tracedWithStackCapture = makeTracedChain(depth, { captureStack: true });
const tracedWithMarkers = makeTracedMarkerChain(depth);
const namedFrameCall = makeNamedFrameCaller();
const plainClosure = makePlainClosure();
const newErrorClosure = makeClosureWithNewErrorHolder();
const captureStackTraceClosure = makeClosureWithCaptureStackTraceHolder();
const asyncMarker = trace(async function asyncMarker() {
  await Promise.resolve();
  marker("after");
});
const asyncManyMarkers = trace(async function asyncManyMarkers() {
  await Promise.resolve();
  marker("after1");
  marker("after2");
  marker("after3");
  marker("after4");
  marker("after5");
});
const asyncStepManyMarkers = trace(async function asyncStepManyMarkers() {
  await trace.step("step", async () => {
    await Promise.resolve();
    marker("after1");
    marker("after2");
    marker("after3");
    marker("after4");
    marker("after5");
  });
});
const syncManyCaptureStackMarkers = trace(function syncManyCaptureStackMarkers() {
  marker("one");
  marker("two");
  marker("three");
  marker("four");
  marker("five");
}, { captureStack: true });

bench
  .add(`${depth} function chain: plain`, () => {
    plain();
  })
  .add(`${depth} function chain: traced (no scope, fast path)`, () => {
    traced();
  })
  .add(`${depth} function chain: traced (in scope)`, () => {
    trace.collect(() => traced());
  })
  .add(`${depth} function chain: traced + captureStack`, () => {
    trace.collect(() => tracedWithStackCapture());
  })
  .add(`${depth} function chain: traced + marker per fn`, () => {
    trace.collect(() => tracedWithMarkers());
  })
  .add("throw/catch Error().stack read", () => {
    try {
      throw new Error();
    } catch (error) {
      sink += error.stack?.length ?? 0;
    }
  })
  .add("new Error().stack read", () => {
    sink += new Error().stack?.length ?? 0;
  })
  .add("plain closure creation", () => {
    sink += makePlainClosure().name.length;
  })
  .add("new Error holder closure creation", () => {
    sink += makeClosureWithNewErrorHolder().name.length;
  })
  .add("captureStackTrace holder closure creation", () => {
    sink += makeClosureWithCaptureStackTraceHolder().name.length;
  })
  .add("plain closure call returns Error, no stack read", () => {
    sink += plainClosure().name.length;
  })
  .add("new Error holder closure call, no stack read", () => {
    sink += newErrorClosure().name.length;
  })
  .add("captureStackTrace holder closure call, no stack read", () => {
    sink += captureStackTraceClosure().name.length;
  })
  .add("captureStackTrace holder closure call + read creation stack", () => {
    sink += captureStackTraceClosure().creationTrace.stack?.length ?? 0;
  })
  .add("Object.defineProperty function name", () => {
    function wrapped() {
      return sink;
    }

    Object.defineProperty(wrapped, "name", {
      configurable: true,
      value: "step",
    });
    sink = (sink + wrapped()) | 0;
  })
  .add("trace() wrapper creation", () => {
    const wrapped = trace(function step() {
      return sink;
    }, { name: "step" });
    sink = (sink + wrapped.name.length) | 0;
  })
  .add("computed named frame call, reused holder", () => {
    namedFrameCall();
  })
  .add("computed named frame call, new holder", () => {
    callNewNamedFrame();
  })
  .add("async marker after await", async () => {
    await trace.collect(() => asyncMarker());
  })
  .add("async 5 markers after await", async () => {
    await trace.collect(() => asyncManyMarkers());
  })
  .add("async step 5 markers after await", async () => {
    await trace.collect(() => asyncStepManyMarkers());
  })
  .add("sync captureStack frame + 5 markers", () => {
    trace.collect(() => syncManyCaptureStackMarkers());
  });

await bench.run();

const rows = bench.table((task) => {
  const hz = task.result?.throughput.mean ?? 0;
  const meanNs = (task.result?.latency.mean ?? 0) * 1_000_000;

  return {
    Task: task.name,
    "ops/sec": Math.round(hz).toLocaleString("en-US"),
    "mean ns": Math.round(meanNs).toLocaleString("en-US"),
    relative: "",
  };
});

const plainHz = bench.getTask(`${depth} function chain: plain`)?.result?.throughput.mean ?? 0;
for (const row of rows) {
  if (!row || !row.Task.includes("function chain") || !plainHz) {
    continue;
  }

  const hz = bench.getTask(row.Task)?.result?.throughput.mean ?? 0;
  row.relative = `${(plainHz / hz).toFixed(1)}x plain cost`;
}

console.log(`@sx/tracer benchmark, depth=${depth}, time=${time}ms`);
console.table(rows);

if (sink === Number.MIN_SAFE_INTEGER) {
  console.log("avoid dead code elimination", sink);
}
