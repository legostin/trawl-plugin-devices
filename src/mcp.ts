import type { McpToolSpec } from "./trawl";

/** Everything the tools need, injected so handlers are testable without a host. */
export interface DevicesApi {
  listDevices(): Promise<unknown>;
  saveDevice(device: Record<string, unknown>): Promise<unknown>;
  startSession(deviceId: string, headless?: boolean): Promise<unknown>;
  stopSession(sessionId: string): Promise<unknown>;
  status(sessionId?: string): Promise<unknown>;
  recordStart(input: { deviceId?: string; sessionId?: string; url?: string }): Promise<unknown>;
  recordStatus(recordingId: string): Promise<unknown>;
  recordStop(recordingId: string, options: { saveAs?: string; withTraffic?: boolean }): Promise<unknown>;
  listScripts(glob?: string): Promise<unknown>;
  readScript(path: string): Promise<unknown>;
  writeScript(path: string, code: string): Promise<unknown>;
  validateScript(input: { path?: string; code?: string }): Promise<unknown>;
  runStart(input: {
    path?: string;
    code?: string;
    deviceId: string;
    sessionId?: string;
    headless?: boolean;
  }): Promise<unknown>;
  runStatus(runId: string): Promise<unknown>;
  runReport(runId: string, verbosity: "summary" | "full"): Promise<unknown>;
  runCancel(runId: string): Promise<unknown>;
  runsList(limit: number): Promise<unknown>;
  snapshot(sessionId: string): Promise<unknown>;
  perform(input: Record<string, unknown>): Promise<unknown>;
  guide(): Promise<string>;
  heal(runId: string, deviceId: string): Promise<unknown>;
  suitesList(): Promise<unknown>;
  suiteRead(path: string): Promise<unknown>;
  suiteWrite(path: string, suite: Record<string, unknown>): Promise<unknown>;
  suiteRun(input: { path?: string; scripts?: string[]; deviceId: string; retries?: number }): Promise<unknown>;
  suiteStatus(suiteId: string): Promise<unknown>;
}

const DO_ACTIONS = ["click", "fill", "check", "uncheck", "select", "hover", "press", "goto", "screenshot"];

const obj = (args: unknown): Record<string, unknown> => (args as Record<string, unknown>) ?? {};

const str = (args: unknown, key: string, required = true): string | undefined => {
  const value = obj(args)[key];
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${key} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
};

export function buildToolSpecs(api: DevicesApi): McpToolSpec[] {
  // Every handler is wrapped so validation errors arrive as a rejected promise
  // rather than a synchronous throw — one predictable shape for callers.
  return specs(api).map((spec) => ({ ...spec, handler: async (args: unknown) => spec.handler(args) }));
}

function specs(api: DevicesApi): McpToolSpec[] {
  return [
    {
      name: "list",
      description: "List test-automation devices from devices.json and any live browser sessions.",
      inputSchema: { type: "object", properties: {} },
      handler: () => api.listDevices(),
    },
    {
      name: "save",
      description:
        "Create or update a device. Only id and name are required; everything else defaults (chromium, headed, 1280x800, Trawl proxy, trace on failure).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          browser: { type: "string", enum: ["chromium", "firefox", "webkit"] },
          headless: { type: "boolean" },
          viewport: {
            type: "object",
            properties: { width: { type: "integer" }, height: { type: "integer" } },
          },
          proxy: {
            type: "object",
            properties: { mode: { type: "string", enum: ["trawl", "none", "custom"] }, url: { type: "string" } },
          },
          trace: { type: "string", enum: ["off", "on-failure", "always"] },
          video: { type: "boolean" },
        },
        required: ["id", "name"],
      },
      handler: (args) => {
        str(args, "id");
        str(args, "name");
        return api.saveDevice(obj(args));
      },
    },
    {
      name: "start",
      description: "Launch a browser session for a device and return its sessionId.",
      inputSchema: {
        type: "object",
        properties: { deviceId: { type: "string" }, headless: { type: "boolean" } },
        required: ["deviceId"],
      },
      handler: (args) => api.startSession(str(args, "deviceId")!, obj(args).headless as boolean | undefined),
    },
    {
      name: "stop",
      description: "Close a browser session.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
      handler: (args) => api.stopSession(str(args, "sessionId")!),
    },
    {
      name: "status",
      description: "Agent version, DSL version and the state of every session (or one session).",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" } } },
      handler: (args) => api.status(str(args, "sessionId", false)),
    },
    {
      name: "record_start",
      description:
        "Start recording a scenario in a browser. Pass deviceId to launch a fresh session, or sessionId to record in an open one.",
      inputSchema: {
        type: "object",
        properties: { deviceId: { type: "string" }, sessionId: { type: "string" }, url: { type: "string" } },
      },
      handler: (args) => {
        const input = obj(args);
        if (!input.deviceId && !input.sessionId) throw new Error("deviceId or sessionId is required");
        return api.recordStart(input as { deviceId?: string; sessionId?: string; url?: string });
      },
    },
    {
      name: "record_status",
      description: "Steps recorded so far — poll this while a human is still clicking.",
      inputSchema: { type: "object", properties: { recordingId: { type: "string" } }, required: ["recordingId"] },
      handler: (args) => api.recordStatus(str(args, "recordingId")!),
    },
    {
      name: "record_stop",
      description:
        "Finish a recording and return the generated DSL script. saveAs writes it under the workspace; withTraffic adds expectResponse steps for observed XHRs.",
      inputSchema: {
        type: "object",
        properties: {
          recordingId: { type: "string" },
          saveAs: { type: "string" },
          withTraffic: { type: "boolean" },
        },
        required: ["recordingId"],
      },
      handler: (args) =>
        api.recordStop(str(args, "recordingId")!, {
          saveAs: str(args, "saveAs", false),
          withTraffic: obj(args).withTraffic as boolean | undefined,
        }),
    },
    {
      name: "scripts_list",
      description: "List scenario scripts in the workspace.",
      inputSchema: { type: "object", properties: { glob: { type: "string" } } },
      handler: (args) => api.listScripts(str(args, "glob", false)),
    },
    {
      name: "script_read",
      description: "Read a scenario script.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: (args) => api.readScript(str(args, "path")!),
    },
    {
      name: "script_write",
      description:
        "Write a scenario script. It is validated first and the write is refused if any step is unknown or the syntax is broken. Call devices_guide before writing your first script.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, code: { type: "string" } },
        required: ["path", "code"],
      },
      handler: (args) => api.writeScript(str(args, "path")!, str(args, "code")!),
    },
    {
      name: "script_validate",
      description:
        "Validate a script without a browser: returns its step list (approximate when the script branches) and any errors.",
      inputSchema: { type: "object", properties: { path: { type: "string" }, code: { type: "string" } } },
      handler: (args) => {
        const input = obj(args);
        if (!input.path && !input.code) throw new Error("path or code is required");
        return api.validateScript(input as { path?: string; code?: string });
      },
    },
    {
      name: "run_start",
      description:
        "Start a run and return its runId immediately. Poll devices_run_status, then read devices_run_report.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          code: { type: "string" },
          deviceId: { type: "string" },
          sessionId: { type: "string" },
          headless: { type: "boolean" },
        },
        required: ["deviceId"],
      },
      handler: (args) => {
        const input = obj(args);
        if (!input.path && !input.code) throw new Error("path or code is required");
        str(args, "deviceId");
        return api.runStart(input as unknown as { deviceId: string });
      },
    },
    {
      name: "run_status",
      description: "Status and progress of a run.",
      inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
      handler: (args) => api.runStatus(str(args, "runId")!),
    },
    {
      name: "run_report",
      description:
        "Run report. Defaults to a summary (verdict, failing step, artifact paths); pass verbosity=full for every step with its HTTP flows.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" }, verbosity: { type: "string", enum: ["summary", "full"] } },
        required: ["runId"],
      },
      handler: (args) => api.runReport(str(args, "runId")!, (obj(args).verbosity as "summary" | "full") ?? "summary"),
    },
    {
      name: "run_cancel",
      description: "Cancel a running scenario.",
      inputSchema: { type: "object", properties: { runId: { type: "string" } }, required: ["runId"] },
      handler: (args) => api.runCancel(str(args, "runId")!),
    },
    {
      name: "runs_list",
      description: "Recent runs, newest first.",
      inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
      handler: (args) => api.runsList(Number(obj(args).limit ?? 20)),
    },
    {
      name: "snapshot",
      description:
        "Accessibility snapshot of the page in a live session: interactive nodes with role, name and a ref to act on.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
      handler: (args) => api.snapshot(str(args, "sessionId")!),
    },
    {
      name: "do",
      description:
        "Perform one action in a live session, by ref (from devices_snapshot) or by declarative target. Returns the new URL, title and console errors.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          action: { type: "string", enum: DO_ACTIONS },
          ref: { type: "string" },
          target: { type: "object" },
          value: { type: "string" },
        },
        required: ["sessionId", "action"],
      },
      timeoutMs: 30_000,
      handler: (args) => {
        const input = obj(args);
        str(args, "sessionId");
        const action = str(args, "action")!;
        if (!DO_ACTIONS.includes(action)) throw new Error(`action must be one of ${DO_ACTIONS.join(", ")}`);
        if (!input.ref && !input.target && action !== "goto") throw new Error("ref or target is required");
        return api.perform(input);
      },
    },
    {
      name: "suites_list",
      description: "List scenario suites in the workspace.",
      inputSchema: { type: "object", properties: {} },
      handler: () => api.suitesList(),
    },
    {
      name: "suite_read",
      description: "Read a suite: its name, the scenarios it runs and how many retries it allows.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: (args) => api.suiteRead(str(args, "path")!),
    },
    {
      name: "suite_write",
      description: "Create or update a suite — a named list of scenarios with an optional retry count.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          name: { type: "string" },
          scripts: { type: "array", items: { type: "string" } },
          retries: { type: "integer" },
        },
        required: ["path", "name", "scripts"],
      },
      handler: (args) => {
        const input = obj(args);
        if (!Array.isArray(input.scripts) || input.scripts.length === 0) {
          throw new Error("scripts must be a non-empty array");
        }
        return api.suiteWrite(str(args, "path")!, {
          name: str(args, "name")!,
          scripts: input.scripts,
          ...(input.retries === undefined ? {} : { retries: Number(input.retries) }),
        });
      },
    },
    {
      name: "suite_run",
      description:
        "Run a suite: every scenario in its own browser, failures do not stop the rest, and a scenario that only passes on a retry is reported flaky. Returns a suiteId to poll with devices_suite_status.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          scripts: { type: "array", items: { type: "string" } },
          deviceId: { type: "string" },
          retries: { type: "integer" },
        },
        required: ["deviceId"],
      },
      handler: (args) => {
        const input = obj(args);
        if (!input.path && !Array.isArray(input.scripts)) throw new Error("path or scripts is required");
        str(args, "deviceId");
        return api.suiteRun(input as { deviceId: string });
      },
    },
    {
      name: "suite_status",
      description: "Progress and per-scenario results of a suite run.",
      inputSchema: { type: "object", properties: { suiteId: { type: "string" } }, required: ["suiteId"] },
      handler: (args) => api.suiteStatus(str(args, "suiteId")!),
    },
    {
      name: "heal",
      description:
        "Diagnose a failed run: replays the scenario up to the failing step, then reports the target that failed and what the page actually offers now, ranked by similarity. Use it before rewriting a broken step.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" }, deviceId: { type: "string" } },
        required: ["runId", "deviceId"],
      },
      timeoutMs: 120_000,
      handler: (args) => api.heal(str(args, "runId")!, str(args, "deviceId")!),
    },
    {
      name: "guide",
      description:
        "How to write device scripts: the DSL vocabulary, target priority and the rules. Read this before writing or editing a scenario.",
      inputSchema: { type: "object", properties: {} },
      handler: () => api.guide(),
    },
  ];
}
