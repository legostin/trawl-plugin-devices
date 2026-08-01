import { expect, it } from "vitest";
import { buildToolSpecs, type DevicesApi } from "./mcp";

const api = (over: Partial<DevicesApi> = {}): DevicesApi => ({
  listDevices: async () => ({ devices: [{ id: "d1" }], sessions: [] }),
  saveDevice: async (d) => ({ device: d }),
  startSession: async (deviceId) => ({ session: { sessionId: "s1", deviceId } }),
  stopSession: async () => ({ ok: true }),
  status: async () => ({ sessions: [], agent: "0.1.0", dsl: 1 }),
  recordStart: async () => ({ id: "rec_1" }),
  recordStatus: async () => ({ id: "rec_1", steps: [] }),
  recordStop: async () => ({ code: "goto('/')\n", steps: [], warnings: [] }),
  listScripts: async () => ({ scripts: ["scripts/a.js"] }),
  readScript: async () => ({ code: "goto('/')\n" }),
  writeScript: async () => ({ path: "scripts/a.js", steps: 1 }),
  validateScript: async () => ({ steps: [], approximate: false, errors: [] }),
  runStart: async () => ({ runId: "r_1", status: "running" }),
  runStatus: async () => ({ runId: "r_1", status: "running", steps: [] }),
  runReport: async (_id, verbosity) => (verbosity === "full" ? { full: true } : { summary: true }),
  runCancel: async () => ({ cancelled: true }),
  runsList: async () => ({ runs: [] }),
  snapshot: async () => ({ nodes: [] }),
  perform: async () => ({ url: "about:blank", title: "", consoleErrors: [] }),
  guide: async () => "# Writing device scripts",
  heal: async () => ({ step: { index: 2 }, candidates: [] }),
  suitesList: async () => ({ suites: ["suites/regression.json"] }),
  suiteRead: async () => ({ name: "regression", scripts: ["scripts/a.js"] }),
  suiteWrite: async (path) => ({ path, scripts: 1 }),
  suiteRun: async () => ({ suiteId: "s_1" }),
  suiteStatus: async () => ({ status: "running", results: [] }),
  mapRead: async () => ({ screens: [] }),
  mapExplore: async () => ({ screen: { id: "s", label: "S" }, candidates: [] }),
  mapWrite: async () => ({ created: ["Войти"], updated: [] }),
  mapEdit: async () => ({ screen: { id: "s" } }),
  mapVerify: async () => ({ screen: "S", entries: [] }),
  scenarioRows: async () => ({ rows: [] }),
  scenarioApply: async () => ({ code: "click('A')\n" }),
  deleteScript: async (path) => ({ deleted: path }),
  recordPause: async (_id, paused) => ({ paused }),
  runPause: async (_id, paused) => ({ paused }),
  mapCoverage: async () => ({ nodes: [], edges: [] }),
  mapDrift: async () => ({ screen: "S", appeared: [], gone: [], usedBy: [] }),
  ...over,
});

const byName = (name: string) => buildToolSpecs(api()).find((s) => s.name === name)!;

it("exposes exactly the planned tools, unprefixed", () => {
  expect(buildToolSpecs(api()).map((s) => s.name).sort()).toEqual([
    "do", "guide", "heal", "list",
    "map_coverage", "map_drift", "map_edit", "map_explore", "map_read", "map_verify", "map_write",
    "record_pause", "record_start", "record_status", "record_stop",
    "run_cancel", "run_pause", "run_report", "run_start", "run_status", "runs_list",
    "save", "scenario_apply", "scenario_rows",
    "script_delete", "script_read", "script_validate", "script_write", "scripts_list",
    "snapshot", "start", "status", "stop",
    "suite_read", "suite_run", "suite_status", "suite_write", "suites_list",
  ]);
});

it("gives every tool a description and an object schema", () => {
  for (const spec of buildToolSpecs(api())) {
    expect(spec.description.length).toBeGreaterThan(10);
    expect(spec.inputSchema).toMatchObject({ type: "object" });
  }
});

it("run_report defaults to the summary shape", async () => {
  expect(await byName("run_report").handler({ runId: "r_1" })).toEqual({ summary: true });
  expect(await byName("run_report").handler({ runId: "r_1", verbosity: "full" })).toEqual({ full: true });
});

it("validates required arguments before calling the api", async () => {
  const calls: string[] = [];
  const spec = buildToolSpecs(
    api({
      readScript: async (p) => {
        calls.push(p);
        return { code: "" };
      },
    }),
  ).find((s) => s.name === "script_read")!;
  await expect(spec.handler({})).rejects.toThrow(/path is required/);
  expect(calls).toEqual([]);
});

it("run_start passes the device and script through", async () => {
  const seen: unknown[] = [];
  const spec = buildToolSpecs(
    api({
      runStart: async (input) => {
        seen.push(input);
        return { runId: "r_9" };
      },
    }),
  ).find((s) => s.name === "run_start")!;
  expect(await spec.handler({ path: "scripts/a.js", deviceId: "d1" })).toEqual({ runId: "r_9" });
  expect(seen[0]).toMatchObject({ path: "scripts/a.js", deviceId: "d1" });
});

it("run_start refuses without a script source", async () => {
  await expect(byName("run_start").handler({ deviceId: "d1" })).rejects.toThrow(/path or code is required/);
});

it("do rejects an action outside the vocabulary", async () => {
  await expect(byName("do").handler({ sessionId: "s1", action: "eval" })).rejects.toThrow(/action must be one of/);
});

it("do requires a ref or a target for element actions", async () => {
  await expect(byName("do").handler({ sessionId: "s1", action: "click" })).rejects.toThrow(/ref or target is required/);
  await expect(byName("do").handler({ sessionId: "s1", action: "goto", value: "https://x" })).resolves.toMatchObject({
    url: "about:blank",
  });
});

it("suite_run refuses without a suite or a script list", async () => {
  await expect(byName("suite_run").handler({ deviceId: "d1" })).rejects.toThrow(/path or scripts is required/);
  await expect(byName("suite_run").handler({ deviceId: "d1", scripts: ["scripts/a.js"] })).resolves.toEqual({
    suiteId: "s_1",
  });
});

it("suite_write insists on at least one scenario", async () => {
  await expect(
    byName("suite_write").handler({ path: "suites/x.json", name: "x", scripts: [] }),
  ).rejects.toThrow(/non-empty array/);
});

it("gives live control a shorter timeout", () => {
  expect(byName("do").timeoutMs).toBe(30_000);
  expect(byName("run_start").timeoutMs).toBeUndefined();
});
