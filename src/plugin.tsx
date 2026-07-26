import type { TrawlHost } from "./trawl";
import { AgentClient } from "./agent";
import { RunController } from "./run";
import { buildToolSpecs } from "./mcp";
import { makeDevicesApi } from "./mcpHost";
import { loadSettings, loadToken } from "./settings";
import { makeDevicesPanel } from "./DevicesPanel";

const host = window.__TRAWL__ as TrawlHost | undefined;

if (host) {
  host.registerMode({ id: "devices", label: "Devices", component: makeDevicesPanel(host) });

  host.events.describe("devices:run-started", {
    description: "A scenario run started.",
    payloadType: "{ runId: string; script: string | null; device: string }",
    source: "devices",
    params: [
      { name: "runId", type: "string", doc: "Run identifier" },
      { name: "script", type: "string | null", doc: "Workspace-relative script path" },
      { name: "device", type: "string", doc: "Device id" },
    ],
  });
  host.events.describe("devices:step-failed", {
    description: "A step failed during a run.",
    payloadType: "{ runId: string; index: number; action: string; error: { kind: string; message: string } }",
    source: "devices",
    params: [
      { name: "runId", type: "string", doc: "Run identifier" },
      { name: "index", type: "number", doc: "Step index" },
      { name: "action", type: "string", doc: "Step name, e.g. expectText" },
      { name: "error", type: "object", doc: "kind and message" },
    ],
  });
  host.events.describe("devices:run-finished", {
    description: "A scenario run finished — payload is the run summary.",
    payloadType:
      "{ runId: string; status: 'passed'|'failed'|'error'; durationMs: number; failedStep: object | null }",
    source: "devices",
    params: [
      { name: "runId", type: "string", doc: "Run identifier" },
      { name: "status", type: "string", doc: "passed | failed | error" },
      { name: "durationMs", type: "number", doc: "Total duration" },
      { name: "failedStep", type: "object | null", doc: "The first failing step, when there is one" },
    ],
  });

  // Registration must happen during initialization, so config is read lazily.
  let cachedPort = 8787;
  let cachedToken: string | null = null;
  void loadSettings(host).then((s) => {
    cachedPort = s.agentPort;
  });
  void loadToken(host).then((t) => {
    cachedToken = t;
  });

  const agent = new AgentClient(host, () => ({ agentPort: cachedPort, token: cachedToken }));
  const runs = new RunController(host, agent);
  const api = makeDevicesApi(agent, runs);

  if (host.mcp) {
    for (const spec of buildToolSpecs(api)) void host.mcp.registerTool(spec);
  }
}
