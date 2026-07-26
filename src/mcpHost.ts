import type { DevicesApi } from "./mcp";
import type { AgentClient } from "./agent";
import { summarise, type RunController, type RunReport } from "./run";

/** Binds the tool specs to the real agent and run controller. */
export function makeDevicesApi(agent: AgentClient, runs: RunController): DevicesApi {
  return {
    listDevices: () => agent.get("/devices"),
    saveDevice: (device) => agent.post("/devices", device),
    startSession: (deviceId, headless) => agent.post("/sessions", { deviceId, headless }),
    stopSession: (sessionId) => agent.del(`/sessions/${sessionId}`),
    status: async (sessionId) => {
      const health = await agent.health();
      const sessions = await agent.get<{ sessions: { sessionId: string }[] }>("/sessions");
      return {
        agent: health.agent,
        dsl: health.dsl,
        workspace: health.workspace,
        sessions: sessionId ? sessions.sessions.filter((s) => s.sessionId === sessionId) : sessions.sessions,
      };
    },
    recordStart: (input) => agent.post("/record/start", input),
    recordStatus: (recordingId) => agent.get(`/record/${recordingId}`),
    recordStop: (recordingId, options) => agent.post(`/record/${recordingId}/stop`, options),
    listScripts: async (glob) => {
      const { scripts } = await agent.get<{ scripts: string[] }>("/scripts");
      return { scripts: glob ? scripts.filter((s) => s.includes(glob)) : scripts };
    },
    readScript: (path) => agent.get("/scripts/read", { path }),
    writeScript: (path, code) => agent.post("/scripts/write", { path, code }),
    validateScript: (input) => agent.post("/scripts/validate", input),
    runStart: async (input) => {
      // The controller needs the source to scan it for secret('…') before the run.
      const code = input.code ?? (await agent.get<{ code: string }>("/scripts/read", { path: input.path })).code;
      const report = await runs.start({ ...input, code });
      return { runId: report.runId, status: report.status };
    },
    runStatus: async (runId) => {
      const report = await runs.poll(runId);
      return {
        runId,
        status: report.status,
        step: report.steps.length,
        lastAction: report.steps.at(-1)?.action ?? null,
      };
    },
    runReport: async (runId, verbosity) => {
      const report = (await runs.poll(runId)) as RunReport;
      return verbosity === "full" ? report : summarise(report);
    },
    runCancel: (runId) => runs.cancel(runId),
    runsList: (limit) => agent.get("/runs", { limit }),
    snapshot: (sessionId) => agent.post("/control/snapshot", { sessionId }),
    perform: (input) => agent.post("/control/do", input),
    guide: async () => (await agent.get<{ guide: string }>("/guide")).guide,
  };
}
