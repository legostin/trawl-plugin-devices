import { expect, it } from "vitest";
import { RunController, summarise, type RunReport } from "./run";
import type { AgentClient } from "./agent";
import type { TrawlHost } from "./trawl";

const report = (over: Partial<RunReport> = {}): RunReport => ({
  runId: "r_1",
  script: "scripts/a.js",
  device: "d1",
  status: "passed",
  startedAt: 1000,
  durationMs: 10,
  warnings: [],
  steps: [
    { index: 0, action: "goto", args: ["/"], status: "passed", startedAt: 1000, durationMs: 5, flows: [] },
  ],
  artifacts: { trace: null, video: null },
  ...over,
});

const harness = () => {
  const calls: { path: string; body?: unknown }[] = [];
  const events: { type: string; payload: unknown }[] = [];
  const order: string[] = [];
  let subscribed = false;
  let postResult: RunReport = report({ status: "running" });
  let getResult: RunReport = report();

  const host = {
    flows: {
      subscribe: () => {
        subscribed = true;
        order.push("subscribe");
        return () => { subscribed = false; };
      },
    },
    events: {
      emit: (type: string, payload: unknown) => { events.push({ type, payload }); },
      on: () => () => {},
      describe: () => {},
    },
    projects: {
      active: () => ({ id: "p", name: "P", env: [{ key: "BASE_URL", value: "https://app.test" }] }),
      onChange: () => () => {},
    },
    secrets: { get: async (n: string) => (n === "PWD" ? "hunter2" : null), list: async () => ["PWD"], set: async () => {} },
    log: () => {},
  } as unknown as TrawlHost;

  const agent = {
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      order.push(path);
      return postResult;
    },
    get: async (path: string) => {
      calls.push({ path });
      return getResult;
    },
    del: async (path: string) => {
      calls.push({ path });
      return { cancelled: true };
    },
  } as unknown as AgentClient;

  return {
    controller: new RunController(host, agent),
    calls,
    events,
    order,
    isSubscribed: () => subscribed,
    setGetResult: (r: RunReport) => { getResult = r; },
  };
};

it("subscribes for correlation before posting the run", async () => {
  const h = harness();
  await h.controller.start({ path: "scripts/a.js", code: "goto('/')", deviceId: "d1" });
  expect(h.order).toEqual(["subscribe", "/runs"]);
});

it("sends the project env and only the scanned secrets", async () => {
  const h = harness();
  await h.controller.start({ path: "scripts/a.js", code: "fill({label:'p'}, secret('PWD'))", deviceId: "d1" });
  const body = h.calls.find((c) => c.path === "/runs")!.body as Record<string, unknown>;
  expect(body.env).toEqual({ BASE_URL: "https://app.test" });
  expect(body.secrets).toEqual({ PWD: "hunter2" });
});

it("refuses to start when a secret is missing", async () => {
  const h = harness();
  await expect(
    h.controller.start({ path: "scripts/a.js", code: "note(secret('NOPE'))", deviceId: "d1" }),
  ).rejects.toThrow(/missing secrets: NOPE/);
  expect(h.calls).toEqual([]);
});

it("emits run-started and run-finished with a step-failed in between", async () => {
  const h = harness();
  h.setGetResult(
    report({
      status: "failed",
      steps: [
        {
          index: 0,
          action: "expectText",
          args: [],
          status: "failed",
          startedAt: 1,
          durationMs: 1,
          flows: [],
          error: { kind: "assertion", message: "nope" },
        },
      ],
    }),
  );
  const started = await h.controller.start({ path: "scripts/a.js", code: "goto('/')", deviceId: "d1" });
  const finished = await h.controller.poll(started.runId);
  expect(finished.status).toBe("failed");
  expect(h.events.map((e) => e.type)).toEqual([
    "devices:run-started",
    "devices:step-failed",
    "devices:run-finished",
  ]);
});

it("unsubscribes once the run is no longer running", async () => {
  const h = harness();
  const started = await h.controller.start({ path: "scripts/a.js", code: "goto('/')", deviceId: "d1" });
  expect(h.isSubscribed()).toBe(true);
  await h.controller.poll(started.runId);
  expect(h.isSubscribed()).toBe(false);
});

it("summarise keeps the verdict and the failing step only", () => {
  const full = report({
    status: "failed",
    steps: [
      { index: 0, action: "goto", args: ["/"], status: "passed", startedAt: 1, durationMs: 1, flows: [] },
      {
        index: 1,
        action: "expectText",
        args: [],
        status: "failed",
        startedAt: 2,
        durationMs: 1,
        flows: [],
        error: { kind: "assertion", message: "nope", expected: "a", actual: "b" },
        screenshot: "step-01.png",
      },
    ],
  });
  const summary = summarise(full);
  expect(summary).toMatchObject({
    runId: "r_1",
    status: "failed",
    stepCount: 2,
    failedStep: { index: 1, action: "expectText", error: { kind: "assertion" }, screenshot: "step-01.png" },
  });
  expect(summary).not.toHaveProperty("steps");
});
