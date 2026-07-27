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
  const createdRules: { name: string; script: string }[] = [];
  const removedRules: string[] = [];
  const events: { type: string; payload: unknown }[] = [];
  const order: string[] = [];
  let subscribed = false;
  let postResult: RunReport = report({ status: "running" });
  let validateSteps: unknown[] = [];
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
    rules: {
      create: async (draft: unknown) => {
        createdRules.push(draft as { name: string; script: string });
        return `rule_${createdRules.length}`;
      },
      remove: async (id: string) => { removedRules.push(id); },
    },
    log: () => {},
  } as unknown as TrawlHost;

  const agent = {
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      order.push(path);
      if (path === "/scripts/validate") return { steps: validateSteps };
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
    createdRules,
    removedRules,
    setValidateSteps: (steps: unknown[]) => { validateSteps = steps; },
    isSubscribed: () => subscribed,
    setGetResult: (r: RunReport) => { getResult = r; },
  };
};

it("subscribes for correlation before posting the run", async () => {
  const h = harness();
  await h.controller.start({ path: "scripts/a.js", code: "goto('/')", deviceId: "d1" });
  // Marker headers only exist in the live stream, so the order matters more
  // than the exact set of calls (mock collection adds one).
  expect(h.order[0]).toBe("subscribe");
  expect(h.order.indexOf("subscribe")).toBeLessThan(h.order.indexOf("/runs"));
});

it("runs what is in the editor, not the file on disk", async () => {
  const h = harness();
  await h.controller.start({ path: "scripts/a.js", code: "goto('/edited')", deviceId: "d1" });
  const body = h.calls.find((c) => c.path === "/runs")!.body as Record<string, unknown>;
  // Both: the code that runs, and the path the report is filed under.
  expect(body.code).toBe("goto('/edited')");
  expect(body.path).toBe("scripts/a.js");
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

it("creates a Trawl rule per mock, scoped to this run, and removes it when the run ends", async () => {
  const h = harness();
  h.setValidateSteps([
    { index: 0, action: "goto", args: ["/"] },
    { index: 1, action: "mock", args: ["GET api/orders", { status: 500 }] },
  ]);

  const started = await h.controller.start({
    path: "scripts/a.js",
    code: "goto('/')\nmock('GET api/orders', { status: 500 })",
    deviceId: "d1",
  });

  expect(h.createdRules).toHaveLength(1);
  expect(h.createdRules[0]!.name).toContain("mock GET api/orders");
  const tag = /x-trawl-tag'\) !== "([^"]+)"/.exec(h.createdRules[0]!.script)![1];
  // The very tag the run is told to stamp on its traffic.
  expect((h.calls.find((c) => c.path === "/runs")!.body as Record<string, unknown>).runTag).toBe(tag);

  await h.controller.poll(started.runId);
  expect(h.removedRules).toEqual(["rule_1"]);
});

it("creates nothing when the scenario has no mocks", async () => {
  const h = harness();
  h.setValidateSteps([{ index: 0, action: "goto", args: ["/"] }]);
  await h.controller.start({ path: "scripts/a.js", code: "goto('/')", deviceId: "d1" });
  expect(h.createdRules).toEqual([]);
});
