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
  mapRead(): Promise<unknown>;
  mapExplore(input: { sessionId: string; url?: string }): Promise<unknown>;
  mapWrite(input: Record<string, unknown>): Promise<unknown>;
  mapEdit(input: Record<string, unknown>): Promise<unknown>;
  mapVerify(input: { sessionId: string; screenId?: string }): Promise<unknown>;
  scenarioRows(code: string): Promise<unknown>;
  scenarioApply(code: string, command: Record<string, unknown>): Promise<unknown>;
  deleteScript(path: string, force?: boolean): Promise<unknown>;
  recordPause(recordingId: string, paused: boolean): Promise<unknown>;
  runPause(runId: string, paused: boolean): Promise<unknown>;
  mapCoverage(): Promise<unknown>;
  mapDrift(input: { sessionId: string; screenId?: string; save?: boolean }): Promise<unknown>;
  proposeScenario(input: { code: string; note?: string; suggestedPath?: string }): Promise<unknown>;
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
      name: "map_read",
      description:
        "The application map: screens, their url patterns, and the elements a scenario can name. Read it before writing a scenario — a step should name an element, not carry a locator.",
      inputSchema: { type: "object", properties: {} },
      handler: () => api.mapRead(),
    },
    {
      name: "map_explore",
      description:
        "Look at a screen in an open session and report what a map for it would contain: candidate elements with their roles and names, each marked when the map already has that name. Writes nothing — call map_write with the ones worth keeping. This is how a screen gets named as a whole rather than one element per click.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" }, url: { type: "string", description: "navigate here first" } },
        required: ["sessionId"],
      },
      timeoutMs: 60_000,
      handler: (args) => api.mapExplore({ sessionId: str(args, "sessionId")!, url: str(args, "url", false) }),
    },
    {
      name: "map_write",
      description:
        "Add or update elements on a screen. Entries land as proposed for a human to accept — a name nobody has read is a guess. Call map_read or map_explore first: an element already in the map must be updated, not duplicated.",
      inputSchema: {
        type: "object",
        properties: {
          screen: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
              match: { type: "object", properties: { url: { type: "string" }, hash: { type: "string" } } },
              open: { type: "object", properties: { url: { type: "string" } } },
            },
            required: ["label"],
          },
          elements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                kind: { type: "string", enum: ["control", "choice"] },
                target: { type: "object", description: "locator: { role, name } | { testId } | { css } …" },
                option: { type: "object", description: "choice only: the shape of one option" },
                api: { type: "array", items: { type: "string" } },
              },
              required: ["label", "target"],
            },
          },
        },
        required: ["screen", "elements"],
      },
      handler: (args) => api.mapWrite(obj(args)),
    },
    {
      name: "map_edit",
      description:
        "Rename, accept, move or delete one entry — or a whole screen, including its url pattern and how to reach it. Renaming keeps the old name as an alias, so scenarios written against it keep working.",
      inputSchema: {
        type: "object",
        properties: {
          screenId: { type: "string" },
          elementKey: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["proposed", "accepted"] },
          moveTo: { type: "string", description: "element only: the screen it belongs to" },
          match: { type: "object", properties: { url: { type: "string" }, hash: { type: "string" } } },
          open: { type: "object", properties: { url: { type: "string" }, flow: { type: "string" } } },
          remove: { type: "boolean" },
        },
        required: ["screenId"],
      },
      handler: (args) => api.mapEdit(obj(args)),
    },
    {
      name: "map_verify",
      description:
        "Resolve a screen's entries against the page in front of the session: which still find exactly one element, which need their fallback, which find nothing. This is how you tell a map that is still true from one that only used to be.",
      inputSchema: {
        type: "object",
        properties: { sessionId: { type: "string" }, screenId: { type: "string" } },
        required: ["sessionId"],
      },
      timeoutMs: 60_000,
      handler: (args) =>
        api.mapVerify({ sessionId: str(args, "sessionId")!, screenId: str(args, "screenId", false) }),
    },
    {
      name: "scenario_rows",
      description:
        "A scenario as editable rows: one per step, with its action, arguments, section and line. Anything not a flat step call comes back as a read-only code row. Use this instead of reading the file when you mean to change one step.",
      inputSchema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      handler: (args) => api.scenarioRows(str(args, "code")!),
    },
    {
      name: "scenario_apply",
      description:
        "Apply one edit to a scenario and get the new source back. Commands: insert, remove, move, setAction, setArg, setDisabled, group, ungroup, rename, extract, moveSection. Editing by command rewrites only the characters that change, so the rest of the file — and its diff — stays as it was.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string" },
          command: { type: "object", description: "{ kind, … } — see the list in the description" },
        },
        required: ["code", "command"],
      },
      handler: (args) => api.scenarioApply(str(args, "code")!, obj(obj(args).command)),
    },
    {
      name: "script_delete",
      description:
        "Delete a scenario. Refuses while another scenario calls it through run(), naming the callers; pass force to go ahead anyway.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string" }, force: { type: "boolean" } },
        required: ["path"],
      },
      handler: (args) => api.deleteScript(str(args, "path")!, obj(args).force === true),
    },
    {
      name: "record_pause",
      description:
        "Stop taking clicks without ending the recording, or start taking them again. What happens while paused — a detour, a captcha — is not part of the scenario.",
      inputSchema: {
        type: "object",
        properties: { recordingId: { type: "string" }, paused: { type: "boolean" } },
        required: ["recordingId"],
      },
      handler: (args) => api.recordPause(str(args, "recordingId")!, obj(args).paused !== false),
    },
    {
      name: "run_pause",
      description:
        "Hold a run between steps, or let it carry on. The browser stays exactly where the scenario left it, which is what makes it possible to look at the page or record the steps it turned out to need.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string" }, paused: { type: "boolean" } },
        required: ["runId"],
      },
      handler: (args) => api.runPause(str(args, "runId")!, obj(args).paused !== false),
    },
    {
      name: "map_coverage",
      description:
        "Screens as nodes and the moves between them as edges, built from the runs that happened. Says which screens no scenario reaches and which transitions rest on a single scenario — the gaps a suite cannot report about itself.",
      inputSchema: { type: "object", properties: {} },
      handler: () => api.mapCoverage(),
    },
    {
      name: "map_drift",
      description:
        "Compare the screen in front of a session against what the map last saw there: what appeared, what went, and which scenarios walk through it. Pass save to take the page as the new baseline instead. A required field that appeared is the change that quietly breaks a dozen scenarios.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string" },
          screenId: { type: "string" },
          save: { type: "boolean", description: "record this page as the baseline" },
        },
        required: ["sessionId"],
      },
      timeoutMs: 60_000,
      handler: (args) =>
        api.mapDrift({
          sessionId: str(args, "sessionId")!,
          screenId: str(args, "screenId", false),
          save: obj(args).save === true,
        }),
    },
    {
      name: "scenario_propose",
      description:
        "Put a scenario in front of the person: it opens in the panel's editor, unsaved, with a note saying what it is. Use this instead of script_write for anything you wrote yourself — a file nobody has read is a file nobody trusts. Validates first and returns the parsed steps, so a broken draft never reaches the screen.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string" },
          note: { type: "string", description: "what was asked for, in the words it was asked in" },
          suggestedPath: { type: "string", description: "e.g. scripts/podacha-bez-ceny.js" },
        },
        required: ["code"],
      },
      handler: (args) =>
        api.proposeScenario({
          code: str(args, "code")!,
          note: str(args, "note", false),
          suggestedPath: str(args, "suggestedPath", false),
        }),
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
