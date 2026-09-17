import { describe, expect, it } from "vitest";
import { marker, Trace, trace } from "../src";

describe("@sx/tracer", () => {
  it("records nested traced calls on one ray", () => {
    const foo = trace(function foo() {});
    const bar = trace(function bar() {
      foo();
    });

    const { names } = trace.collect(() => bar());

    expect(names).toEqual(["bar", "foo"]);
    expect(foo.ray).toBe(bar.ray);
  });

  it("matches the plain parent plus traced child DX", () => {
    const foo = trace(function foo() {});
    function bar() {
      foo();
    }

    const run = trace(bar);
    const { names } = trace.collect(() => run());

    expect(names).toEqual(["bar", "foo"]);
  });

  it("records inline markers under the active function name", () => {
    const foo = trace(function foo() {
      marker("start");
      marker("end", { ok: true });
    });

    const { names, events } = trace.collect(() => foo());

    expect(names).toEqual(["foo", "foo.start", "foo.end"]);
    expect(events.at(-1)?.data).toEqual({ ok: true });
  });

  it("attributes markers to the active frame after child calls", () => {
    const foo = trace(function foo() {
      marker("inside");
    });
    const bar = trace(function bar() {
      foo();
      marker("after");
    });

    const { names } = trace.collect(() => bar());

    expect(names).toEqual(["bar", "foo", "foo.inside", "bar.after"]);
  });

  it("keeps marker ownership across an awaited step", async () => {
    const foo = trace(async function foo() {
      marker("start");
      await Promise.resolve();
      marker("end");
    });

    const { names } = await trace.collect(() => foo());

    expect(names).toEqual(["foo", "foo.start", "foo.end"]);
  });

  it("keeps marker ownership across promise chains", async () => {
    const foo = trace(function foo() {
      marker("start");
      return Promise.resolve().then(() => {
        marker("then");
      });
    });

    const { names } = await trace.collect(() => foo());

    expect(names).toEqual(["foo", "foo.start", "foo.then"]);
  });

  it("keeps overlapping async rays separated", async () => {
    const releases: Array<() => void> = [];
    const wait = () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    const first = trace(async function first() {
      marker("start");
      await wait();
      marker("end");
    });
    const second = trace(async function second() {
      marker("start");
      await wait();
      marker("end");
    });

    const firstRun = trace.collect(() => first());
    const secondRun = trace.collect(() => second());
    releases[1]();
    const secondResult = await secondRun;
    releases[0]();
    const firstResult = await firstRun;

    expect(firstResult.ray).not.toBe(secondResult.ray);
    expect(firstResult.names).toEqual(["first", "first.start", "first.end"]);
    expect(secondResult.names).toEqual(["second", "second.start", "second.end"]);
  });

  it("does not attach unrelated sync calls to pending async rays", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asyncTask = trace(async function asyncTask() {
      await wait;
      marker("end");
    });
    const syncTask = trace(function syncTask() {});

    const run = trace.collect(() => asyncTask());
    const syncResult = trace.collect(() => syncTask());
    release();
    const asyncResult = await run;

    expect(syncResult.ray).not.toBe(asyncResult.ray);
    expect(syncResult.names).toEqual(["syncTask"]);
    expect(asyncResult.names).toEqual(["asyncTask", "asyncTask.end"]);
  });

  it("keeps markers after await inside explicit steps on the active ray", async () => {
    const root = trace(async function root() {
      marker("before");
      await trace.step("heavy", async () => {
        await Promise.resolve();
        marker("done");
      });
      marker("after");
    });

    const { names } = await trace.collect(() => root());

    expect(names).toEqual(["root", "root.before", "heavy.done", "root.after"]);
  });

  it("keeps overlapping async steps separated", async () => {
    const releases: Array<() => void> = [];
    const wait = () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      });
    const first = trace(async function first() {
      await trace.step("work", async () => {
        await wait();
        marker("done");
      });
    });
    const second = trace(async function second() {
      await trace.step("work", async () => {
        await wait();
        marker("done");
      });
    });

    const firstRun = trace.collect(() => first());
    const secondRun = trace.collect(() => second());
    releases[1]();
    const secondResult = await secondRun;
    releases[0]();
    const firstResult = await firstRun;

    expect(firstResult.names).toEqual(["first", "work.done"]);
    expect(secondResult.names).toEqual(["second", "work.done"]);
  });

  it("keeps the wrapped function return value and this binding", () => {
    const target = {
      value: 41,
      next: trace(function next(this: { value: number }, by: number) {
        return this.value + by;
      }),
    };

    const { result, names } = trace.collect(() => target.next(1));

    expect(result).toBe(42);
    expect(names).toEqual(["next"]);
  });

  it("captures stacks lazily when requested", () => {
    const foo = trace(function foo() {}, { captureStack: true });

    const { events } = trace.collect(() => foo());
    const [event] = events;

    expect(Object.getOwnPropertyDescriptor(event, "stack")?.get).toBeTypeOf("function");
    expect(event!.stack).toContain("foo");
    expect(event!.stack).not.toContain("Object.<anonymous>");
  });

  it("captures the event-time stack when lazy stack is read later", () => {
    const foo = trace(function foo() {}, { captureStack: true });

    const { events } = trace.collect(() => foo());
    const [event] = events;
    const readLater = () => event!.stack;

    expect(readLater()).toContain("foo");
    expect(readLater()).not.toContain("readLater");
    expect(event!.stack).toContain("Error");
  });

  it("reuses one stack holder across nested sync captureStack calls", () => {
    const OriginalError = globalThis.Error;
    let constructed = 0;
    const CountingError = new Proxy(OriginalError, {
      construct(target, args, newTarget) {
        constructed += 1;
        return Reflect.construct(target, args, newTarget);
      },
    });
    globalThis.Error = CountingError as ErrorConstructor;
    try {
      const a = trace(function a() {}, { captureStack: true });
      const b = trace(function b() {
        a();
      }, { captureStack: true });

      trace.collect(() => b());

      expect(constructed).toBe(1);
    } finally {
      globalThis.Error = OriginalError;
    }
  });

  it("does not invent frames for untraced child functions", () => {
    function foo() {}
    const bar = trace(function bar() {
      foo();
    });

    const { names } = trace.collect(() => bar());

    expect(names).toEqual(["bar"]);
  });

  it("traces every method on a class with @Trace", () => {
    @Trace
    class Service {
      validate(user: { id: string }) {
        return user.id.length > 0;
      }
      save(user: { id: string }) {
        if (!this.validate(user)) {
          throw new Error("invalid user");
        }
        return "saved";
      }
    }

    const service = new Service();
    const { result, names } = trace.collect(() => service.save({ id: "u1" }));

    expect(result).toBe("saved");
    expect(names).toEqual(["Service.save", "Service.validate"]);
  });

  it("traces a single method with @Trace", () => {
    class Service {
      @Trace
      run() {
        marker("inside");
      }
    }

    const service = new Service();
    const { names } = trace.collect(() => service.run());

    expect(names).toEqual(["run", "run.inside"]);
  });

  it("notifies subscribers about every event", () => {
    const events: string[] = [];
    const unsubscribe = trace.subscribe((event) => {
      events.push(event.name);
    });

    const foo = trace(function foo() {
      marker("hit");
    });

    try {
      trace.collect(() => foo());
    } finally {
      unsubscribe();
    }

    expect(events).toEqual(["foo", "foo.hit"]);
  });

  it("supports multiple subscribers and clean unsubscribe", () => {
    const a: string[] = [];
    const b: string[] = [];
    const offA = trace.subscribe((e) => a.push(e.name));
    const offB = trace.subscribe((e) => b.push(e.name));

    const foo = trace(function foo() {});

    try {
      trace.collect(() => foo());
      offA();
      trace.collect(() => foo());
    } finally {
      offB();
    }

    expect(a).toEqual(["foo"]);
    expect(b).toEqual(["foo", "foo"]);
  });

  it("captureArgs records call arguments", () => {
    const foo = trace(function foo(a: number, b: number) {
      return a + b;
    }, { captureArgs: true });

    const { events } = trace.collect(() => foo(2, 3));
    expect(events[0]?.args).toEqual([2, 3]);
  });

  it("captureArgs can transform/redact", () => {
    const login = trace(function login(user: string, password: string) {
      return `${user}:ok`;
    }, { captureArgs: (args) => ({ user: args[0], password: "[redacted]" }) });

    const { events } = trace.collect(() => login("alice", "secret"));
    expect(events[0]?.args).toEqual({ user: "alice", password: "[redacted]" });
  });

  it("captureResult records the return value", () => {
    const compute = trace(function compute(n: number) {
      return n * 2;
    }, { captureResult: true });

    const { events } = trace.collect(() => compute(21));
    expect(events[0]?.result).toBe(42);
  });

  it("captureError records thrown errors", () => {
    const boom = trace(function boom() {
      throw new Error("boom");
    }, { captureError: true });

    let thrown: unknown;
    try {
      trace.collect(() => boom());
    } catch (e) {
      thrown = e;
    }

    expect((thrown as Error).message).toBe("boom");
  });

  it("captureTiming records duration after the call settles", async () => {
    const slow = trace(async function slow() {
      await new Promise((r) => setTimeout(r, 5));
    }, { captureTiming: true });

    const { events } = await trace.collect(() => slow());
    expect(events[0]?.duration).toBeGreaterThan(0);
  });

  it("works without captureTiming (duration stays undefined)", () => {
    const foo = trace(function foo() {});
    const { events } = trace.collect(() => foo());
    expect(events[0]?.duration).toBeUndefined();
  });

  it("traced function exposes `.ray` after a scope", () => {
    const foo = trace(function foo() {});
    const { ray } = trace.collect(() => foo());
    expect(foo.ray).toBe(ray);
  });
});
