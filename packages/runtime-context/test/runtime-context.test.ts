import { describe, expect, it } from "vitest";
import { capture, createContext } from "../src";

describe("@sx/runtime-context", () => {
  it("returns the provided value inside the scope", () => {
    const ctx = createContext<{ id: number }>();
    let captured: { id: number } | undefined;

    ctx.provider({ id: 1 }).run(() => {
      captured = ctx.get();
    });

    expect(captured).toEqual({ id: 1 });
  });

  it("returns undefined outside any provider with no default", () => {
    const ctx = createContext<{ id: number }>();
    expect(ctx.get()).toBeUndefined();
  });

  it("returns the default value outside any provider", () => {
    const ctx = createContext<{ id: number }>({ id: 0 });
    expect(ctx.get()).toEqual({ id: 0 });
  });

  it("innermost provider wins for nested same-context scopes", () => {
    const ctx = createContext<number>();
    const captured: number[] = [];

    ctx.provider(1).run(() => {
      captured.push(ctx.get()!);
      ctx.provider(2).run(() => {
        captured.push(ctx.get()!);
      });
      captured.push(ctx.get()!);
    });

    expect(captured).toEqual([1, 2, 1]);
  });

  it("multiple contexts can be active at once", () => {
    const a = createContext<string>();
    const b = createContext<number>();

    let aValue: string | undefined;
    let bValue: number | undefined;

    a.provider("hello").run(() => {
      b.provider(42).run(() => {
        aValue = a.get();
        bValue = b.get();
      });
    });

    expect(aValue).toBe("hello");
    expect(bValue).toBe(42);
  });

  it("propagates value across an awaited section", async () => {
    const ctx = createContext<string>();

    async function inner() {
      await Promise.resolve();
      return ctx.get();
    }

    const result = await ctx.provider("propagated").run(() => inner());
    expect(result).toBe("propagated");
  });

  it("propagates value across multiple awaits", async () => {
    const ctx = createContext<number>();

    async function inner() {
      const before = ctx.get();
      await Promise.resolve();
      const middle = ctx.get();
      await Promise.resolve();
      const after = ctx.get();
      return [before, middle, after];
    }

    const result = await ctx.provider(7).run(() => inner());
    expect(result).toEqual([7, 7, 7]);
  });

  it("keeps nested providers separate across awaits", async () => {
    const ctx = createContext<number>();

    async function inner() {
      await Promise.resolve();
      return ctx.get();
    }

    const result = await ctx.provider(1).run(async () => {
      const outer = ctx.get();
      await Promise.resolve();
      const innerResult = await ctx.provider(2).run(() => inner());
      const back = ctx.get();
      return { outer, inner: innerResult, back };
    });

    expect(result).toEqual({ outer: 1, inner: 2, back: 1 });
  });

  it("nested providers under different contexts both survive await", async () => {
    const a = createContext<string>();
    const b = createContext<number>();

    async function inner() {
      await Promise.resolve();
      return { a: a.get(), b: b.get() };
    }

    const result = await a.provider("x").run(() =>
      b.provider(9).run(() => inner()),
    );

    expect(result).toEqual({ a: "x", b: 9 });
  });

  it("keeps concurrent provider scopes isolated", async () => {
    const ctx = createContext<number>();
    const releases: Array<() => void> = [];
    const wait = () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      });

    async function read(): Promise<number | undefined> {
      await wait();
      return ctx.get();
    }

    const first = ctx.provider(1).run(() => read());
    const second = ctx.provider(2).run(() => read());

    releases[1]!();
    const r2 = await second;
    releases[0]!();
    const r1 = await first;

    expect(r1).toBe(1);
    expect(r2).toBe(2);
  });

  it("restores the previous frame on synchronous throw", () => {
    const ctx = createContext<number>();
    let seen: number | undefined;

    expect(() =>
      ctx.provider(99).run(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    seen = ctx.get();
    expect(seen).toBeUndefined();
  });

  it("restores the previous frame on awaited rejection", async () => {
    const ctx = createContext<number>();

    await expect(
      ctx.provider(5).run(async () => {
        await Promise.resolve();
        throw new Error("kaput");
      }),
    ).rejects.toThrow("kaput");

    expect(ctx.get()).toBeUndefined();
  });

  it("returns from synchronous run with the function's value", () => {
    const ctx = createContext<number>();
    const result = ctx.provider(1).run(() => ctx.get()! * 2);
    expect(result).toBe(2);
  });

  it("cannot see context for fire-and-forget plain async (documented limitation)", async () => {
    const ctx = createContext<number>();
    let dangling: Promise<number | undefined>;

    async function unwrapped(): Promise<number | undefined> {
      await Promise.resolve();
      return ctx.get();
    }

    ctx.provider(1).run(() => {
      dangling = unwrapped();
    });

    const result = await dangling!;
    expect(result).toBeUndefined();
  });

  describe("capture", () => {
    it("re-establishes context inside a setTimeout callback", async () => {
      const ctx = createContext<number>();

      const seen = await ctx.provider(1).run(
        () =>
          new Promise<number | undefined>((resolve) => {
            setTimeout(
              capture(() => {
                resolve(ctx.get());
              }),
              0,
            );
          }),
      );

      expect(seen).toBe(1);
    });

    it("captures the current frame at call time, not at invocation", () => {
      const ctx = createContext<string>();
      const inside = ctx.provider("inside").run(() => capture(() => ctx.get()));

      expect(inside()).toBe("inside");
      expect(ctx.get()).toBeUndefined();
    });

    it("returns the captured value even after the original scope ends", async () => {
      const ctx = createContext<number>();
      const captured = ctx.provider(42).run(() => capture(() => ctx.get()));
      await new Promise((r) => setTimeout(r, 0));
      expect(captured()).toBe(42);
    });

    it("forwards arguments and `this` to the wrapped function", () => {
      const ctx = createContext<number>();
      const fn = ctx.provider(7).run(() =>
        capture(function (this: { multiplier: number }, n: number) {
          return ctx.get()! * n * this.multiplier;
        }),
      );

      expect(fn.call({ multiplier: 3 }, 4)).toBe(7 * 4 * 3);
    });

    it("preserves the captured context across setTimeout after await", async () => {
      const ctx = createContext<string>();

      const seen = await ctx.provider("post-await").run(async () => {
        await Promise.resolve();
        return new Promise<string | undefined>((resolve) => {
          setTimeout(
            capture(() => resolve(ctx.get())),
            0,
          );
        });
      });

      expect(seen).toBe("post-await");
    });

    it("captures nothing when called outside any provider", () => {
      const ctx = createContext<number>(99);
      const fn = capture(() => ctx.get());
      expect(fn()).toBe(99);
    });

    it("does not leak the captured frame onto callers", () => {
      const ctx = createContext<number>();
      const sneaky = ctx.provider(5).run(() => capture(() => ctx.get()));

      ctx.provider(10).run(() => {
        expect(sneaky()).toBe(5);
        expect(ctx.get()).toBe(10);
      });
    });
  });

  describe("falsy and edge values", () => {
    it("preserves an explicit `undefined` over the default", () => {
      const ctx = createContext<number | undefined>(99);
      let seen: number | undefined = -1;
      ctx.provider(undefined).run(() => {
        seen = ctx.get();
      });
      expect(seen).toBeUndefined();
    });

    it("returns 0 inside a provider that bound 0", () => {
      const ctx = createContext<number>(1);
      let seen = -1;
      ctx.provider(0).run(() => {
        seen = ctx.get();
      });
      expect(seen).toBe(0);
    });

    it("returns an empty string inside a provider that bound it", () => {
      const ctx = createContext<string>("default");
      let seen = "unset";
      ctx.provider("").run(() => {
        seen = ctx.get();
      });
      expect(seen).toBe("");
    });

    it("returns null inside a provider that bound null", () => {
      const ctx = createContext<null | string>("default");
      let seen: null | string = "unset";
      ctx.provider(null).run(() => {
        seen = ctx.get();
      });
      expect(seen).toBeNull();
    });
  });

  describe("deeply nested scopes", () => {
    it("walks through many nested providers to find the right context", () => {
      const target = createContext<string>();
      const noise = createContext<number>();

      let captured: string | undefined;
      const build = (depth: number, run: () => void) => {
        if (depth === 0) return run();
        noise.provider(depth).run(() => build(depth - 1, run));
      };

      target.provider("hello").run(() => {
        build(20, () => {
          captured = target.get();
        });
      });

      expect(captured).toBe("hello");
    });
  });
});
