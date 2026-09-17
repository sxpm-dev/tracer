// A typical "request context" pattern — bind ambient values at the request
// boundary, read them from any function called during the request.
//
// Run with: npx tsx examples/01-request-context.ts

import { createContext } from "../src";

interface RequestEnv {
  userId: string;
  traceId: string;
}

const RequestContext = createContext<RequestEnv>();

async function loadProfile(): Promise<{ name: string }> {
  const env = RequestContext.get();
  if (!env) throw new Error("no request context");
  await new Promise((r) => setTimeout(r, 1));
  return { name: `User ${env.userId}` };
}

function log(message: string) {
  const env = RequestContext.get();
  console.log(`[${env?.traceId ?? "no-trace"}]`, message);
}

async function handleRequest() {
  log("start");
  const profile = await loadProfile();
  log(`loaded ${profile.name}`);
  return profile;
}

async function main() {
  await RequestContext.provider({ userId: "u1", traceId: "abc" }).run(() =>
    handleRequest(),
  );
  await RequestContext.provider({ userId: "u2", traceId: "xyz" }).run(() =>
    handleRequest(),
  );
}

main();

// Output:
// [abc] start
// [abc] loaded User u1
// [xyz] start
// [xyz] loaded User u2
