// Async tracing with markers and named child sections.
//
// Run with: npx tsx examples/02-async-with-step.ts

import { marker, trace } from "../src";

async function fetchUser(id: string) {
  await new Promise((r) => setTimeout(r, 1));
  return { id, name: "Alice" };
}

async function fetchOrders(userId: string) {
  await new Promise((r) => setTimeout(r, 1));
  return [{ id: "o1", userId, total: 42 }];
}

const handleRequest = trace(async function handleRequest(userId: string) {
  marker("auth-ok", { userId });

  const user = await trace.step("load-user", async () => {
    const u = await fetchUser(userId);
    marker("found");
    return u;
  });

  const orders = await trace.step("load-orders", async () => {
    const o = await fetchOrders(userId);
    marker("count", { n: o.length });
    return o;
  });

  marker("response-ready");
  return { user, orders };
});

const { result, names } = await trace.collect(() => handleRequest("u1"));

console.log("response:", result);
console.log("trace:");
for (const name of names) console.log("  ", name);

// Output:
// response: { user: { id: 'u1', name: 'Alice' }, orders: [ { id: 'o1', ... } ] }
// trace:
//    handleRequest
//    handleRequest.auth-ok
//    load-user.found
//    load-orders.count
//    handleRequest.response-ready
