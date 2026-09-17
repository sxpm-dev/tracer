// Forward every traced event to an external system using trace.subscribe.
// Typical shape for OpenTelemetry / Sentry / console adapters.
//
// Run with: npx tsx examples/03-telemetry-forwarder.ts

import { marker, Trace, trace } from "../src";

// Pretend this is your monitoring SDK.
const monitoring = {
  record(payload: Record<string, unknown>) {
    console.log("[mon]", JSON.stringify(payload));
  },
};

// Wire the tracer to monitoring. Returns an `off` you call on shutdown.
const off = trace.subscribe((event) => {
  monitoring.record({
    name: event.name,
    kind: event.kind,
    ray: event.ray,
    at: event.at,
    parent: event.parent,
    data: event.data,
  });
});

@Trace
class Worker {
  process(job: { id: string }) {
    marker("dequeue", { jobId: job.id });
    this.validate(job);
    marker("complete");
  }

  private validate(job: { id: string }) {
    if (!job.id) throw new Error("missing id");
  }
}

const worker = new Worker();
trace.collect(() => worker.process({ id: "j1" }));

off();

// Output (one line per recorded event):
// [mon] {"name":"Worker.process","kind":"call","ray":"...","at":...,"parent":0,"data":null}
// [mon] {"name":"Worker.process.dequeue","kind":"marker","ray":"...","at":...,"parent":1,"data":{"jobId":"j1"}}
// [mon] {"name":"Worker.validate","kind":"call","ray":"...","at":...,"parent":1,"data":null}
// [mon] {"name":"Worker.process.complete","kind":"marker","ray":"...","at":...,"parent":1,"data":null}
