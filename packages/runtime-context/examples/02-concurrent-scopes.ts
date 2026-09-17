// Concurrent provider scopes stay isolated — useful for parallel work where
// each branch needs its own ambient value.
//
// Run with: npx tsx examples/02-concurrent-scopes.ts

import { createContext } from "../src";

const TaskContext = createContext<{ id: string }>();

async function step(label: string) {
  const { id } = TaskContext.get()!;
  console.log(`task ${id}: ${label}`);
  await new Promise((r) => setTimeout(r, 1));
}

async function runTask() {
  await step("start");
  await step("middle");
  await step("end");
}

async function main() {
  await Promise.all([
    TaskContext.provider({ id: "A" }).run(() => runTask()),
    TaskContext.provider({ id: "B" }).run(() => runTask()),
    TaskContext.provider({ id: "C" }).run(() => runTask()),
  ]);
}

main();

// Output (order may interleave, but each task's id stays consistent):
// task A: start
// task B: start
// task C: start
// task A: middle
// task B: middle
// task C: middle
// task A: end
// task B: end
// task C: end
