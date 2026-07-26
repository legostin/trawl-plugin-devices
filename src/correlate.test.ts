import { expect, it } from "vitest";
import { Correlator, readMarker } from "./correlate";
import type { Flow, TrawlHost } from "./trawl";

const flow = (over: Partial<Flow> & { headers?: [string, string][] } = {}): Flow => ({
  id: over.id ?? 1,
  timestamp: over.timestamp ?? 1000,
  method: over.method ?? "POST",
  url: over.url ?? { scheme: "https", host: "api.test", port: 443, path: "/v4/login" },
  request: {
    headers: over.headers ?? [
      ["x-trawl-run", "r_1"],
      ["x-trawl-step", "3"],
    ],
    body: "",
    bodyIsText: true,
  },
  response: over.response ?? { status: 200, headers: [] },
  state: "completed",
});

const fakeHost = () => {
  let listener: ((f: unknown) => void) | null = null;
  const host = {
    flows: {
      subscribe: (cb: (f: unknown) => void) => {
        listener = cb;
        return () => { listener = null; };
      },
    },
  } as unknown as TrawlHost;
  return { host, emit: (f: Flow) => listener?.(f), isSubscribed: () => listener !== null };
};

it("reads a marker header case-insensitively", () => {
  expect(readMarker(flow({ headers: [["X-Trawl-Step", "7"]] }), "x-trawl-step")).toBe("7");
  expect(readMarker(flow({ headers: [] }), "x-trawl-step")).toBeNull();
});

it("maps flows to their step by marker", () => {
  const { host, emit } = fakeHost();
  const correlator = new Correlator(host);
  correlator.start("r_1");
  emit(flow({ id: 11 }));
  emit(flow({ id: 12, url: { scheme: "https", host: "api.test", port: 443, path: "/v4/me" } }));
  expect(correlator.linksFor(3).map((l) => l.flowId)).toEqual([11, 12]);
  expect(correlator.linksFor(3)[0]).toMatchObject({ method: "POST", status: 200, approx: false });
  expect(correlator.linksFor(3)[0]!.url).toBe("https://api.test/v4/login");
});

it("ignores flows from other runs", () => {
  const { host, emit } = fakeHost();
  const correlator = new Correlator(host);
  correlator.start("r_1");
  emit(
    flow({
      id: 20,
      headers: [
        ["x-trawl-run", "r_other"],
        ["x-trawl-step", "3"],
      ],
    }),
  );
  expect(correlator.linksFor(3)).toEqual([]);
});

it("unsubscribes on stop", () => {
  const { host, isSubscribed } = fakeHost();
  const correlator = new Correlator(host);
  correlator.start("r_1");
  expect(isSubscribed()).toBe(true);
  correlator.stop();
  expect(isSubscribed()).toBe(false);
});

it("merges links into a report and falls back to approx by time window", () => {
  const { host, emit } = fakeHost();
  const correlator = new Correlator(host);
  correlator.start("r_1");
  emit(flow({ id: 11 }));
  // A flow the markers missed, inside step 4's window.
  emit(flow({ id: 99, timestamp: 5_500, headers: [] }));

  const merged = correlator.merge({
    runId: "r_1",
    steps: [
      {
        index: 3,
        startedAt: 1_000,
        durationMs: 100,
        flows: [{ method: "POST", url: "https://api.test/v4/login", status: 200 }],
      },
      {
        index: 4,
        startedAt: 5_000,
        durationMs: 1_000,
        flows: [{ method: "POST", url: "https://api.test/v4/login", status: 200 }],
      },
    ],
    warnings: [] as string[],
  });

  expect(merged.steps[0]!.flows[0]).toMatchObject({ flowId: 11, approx: false });
  expect(merged.steps[1]!.flows[0]).toMatchObject({ flowId: 99, approx: true });
  expect(merged.warnings.some((w) => w.includes("approx"))).toBe(true);
});

it("never throws out of merge", () => {
  const { host } = fakeHost();
  const correlator = new Correlator(host);
  correlator.start("r_1");
  expect(() =>
    correlator.merge({ runId: "r_1", steps: null as never, warnings: [] }),
  ).not.toThrow();
});
