---
title: "Edge Request"
description: "Bind request metadata in an edge-style handler."
---

# Edge Request

`@sx/runtime-context` is useful where `AsyncLocalStorage` may not exist, such as
browser-like edge runtimes.

```ts
import { createContext } from "@sx/runtime-context";

const requestContext = createContext<{
  requestId: string;
  country?: string;
  locale: string;
}>();

export default async function handle(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const country = request.headers.get("cf-ipcountry") ?? undefined;
  const locale = request.headers.get("accept-language")?.split(",")[0] ?? "en";

  return requestContext.provider({ requestId, country, locale }).run(async () => {
    const body = await renderPage();
    return new Response(body, {
      headers: {
        "content-type": "text/html",
        "x-request-id": requestId,
      },
    });
  });
}

async function renderPage() {
  const request = requestContext.get();
  const copy = await loadCopy(request?.locale ?? "en");
  audit("render-page", { requestId: request?.requestId, country: request?.country });
  return `<main>${copy.title}</main>`;
}
```

The handler owns the boundary. Internal helpers can read metadata without
depending on a platform-specific async context API.
