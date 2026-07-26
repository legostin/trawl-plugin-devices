import type { TrawlHost } from "./trawl";
import type { AgentClient } from "./agent";
import { Correlator } from "./correlate";
import { envSnapshot, resolveSecrets, scanSecrets } from "./secrets";

export interface StepReport {
  index: number;
  action: string;
  args: unknown[];
  name?: string;
  status: "passed" | "failed" | "skipped";
  startedAt: number;
  durationMs: number;
  error?: { kind: string; message: string; expected?: string; actual?: string };
  screenshot?: string;
  flows: { method: string; url: string; status: number | null; flowId?: number; approx?: boolean }[];
}

export interface RunReport {
  runId: string;
  script: string | null;
  device: string;
  status: "running" | "passed" | "failed" | "error";
  startedAt: number;
  durationMs: number;
  steps: StepReport[];
  artifacts: { trace: string | null; video: string | null };
  warnings: string[];
}

export interface StartInput {
  path?: string;
  code: string;
  deviceId: string;
  sessionId?: string;
  headless?: boolean;
  /** Trawl's live proxy port, so the run is captured even if the agent was
   *  started with a different default. */
  proxyPort?: number;
  stepDelayMs?: number;
  closeAfterRun?: boolean;
}

/** The compact shape MCP returns by default. */
export function summarise(report: RunReport) {
  const failed = report.steps.find((s) => s.status === "failed");
  return {
    runId: report.runId,
    script: report.script,
    device: report.device,
    status: report.status,
    durationMs: report.durationMs,
    stepCount: report.steps.length,
    failedStep: failed
      ? { index: failed.index, action: failed.action, error: failed.error, screenshot: failed.screenshot }
      : null,
    artifacts: report.artifacts,
    warnings: report.warnings,
  };
}

export class RunController {
  private readonly correlators = new Map<string, Correlator>();
  private readonly reports = new Map<string, RunReport>();

  constructor(
    private readonly host: TrawlHost,
    private readonly agent: AgentClient,
  ) {}

  /** Subscribe first, then post: markers are only visible in the live stream. */
  async start(input: StartInput): Promise<RunReport> {
    const secrets = await resolveSecrets(this.host, scanSecrets(input.code));
    const correlator = new Correlator(this.host);
    correlator.start("");

    try {
      const report = await this.agent.post<RunReport>("/runs", {
        ...(input.path ? { path: input.path } : { code: input.code }),
        deviceId: input.deviceId,
        sessionId: input.sessionId,
        headless: input.headless,
        proxyPort: input.proxyPort,
        stepDelayMs: input.stepDelayMs,
        closeAfterRun: input.closeAfterRun,
        env: envSnapshot(this.host),
        secrets,
      });
      correlator.adopt(report.runId);
      this.correlators.set(report.runId, correlator);
      this.reports.set(report.runId, report);
      this.host.events.emit("devices:run-started", {
        runId: report.runId,
        script: report.script,
        device: report.device,
      });
      return report;
    } catch (err) {
      correlator.stop();
      throw err;
    }
  }

  /** Fetch the latest report, merge correlation, emit events once the run ends. */
  async poll(runId: string): Promise<RunReport> {
    const fresh = await this.agent.get<RunReport>(`/runs/${runId}`);
    const correlator = this.correlators.get(runId);
    const merged = correlator ? correlator.merge(fresh) : fresh;
    const previous = this.reports.get(runId);
    this.reports.set(runId, merged);

    if (merged.status !== "running") {
      correlator?.stop();
      this.correlators.delete(runId);
      if (previous === undefined || previous.status === "running") {
        const failed = merged.steps.find((s) => s.status === "failed");
        if (failed) {
          this.host.events.emit("devices:step-failed", {
            runId,
            index: failed.index,
            action: failed.action,
            error: failed.error,
          });
        }
        this.host.events.emit("devices:run-finished", summarise(merged));
      }
    }
    return merged;
  }

  report(runId: string): RunReport | undefined {
    return this.reports.get(runId);
  }

  async cancel(runId: string): Promise<{ cancelled: boolean }> {
    const result = await this.agent.del<{ cancelled: boolean }>(`/runs/${runId}`);
    this.correlators.get(runId)?.stop();
    this.correlators.delete(runId);
    return result;
  }

  /** Poll until the run finishes or `timeoutMs` elapses. */
  async waitFor(runId: string, timeoutMs = 10 * 60_000, intervalMs = 1000): Promise<RunReport> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const report = await this.poll(runId);
      if (report.status !== "running") return report;
      if (Date.now() > deadline) return report;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
