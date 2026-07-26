import type { TrawlHost } from "./trawl";
import type { AgentClient } from "./agent";
import { Correlator } from "./correlate";
import { collectSecretNames, envSnapshot, resolveSecrets } from "./secrets";
import {
  approximateRanges,
  collectMocks,
  diagnoseMocks,
  ruleDraft,
  type MockPlan,
  type StepRecordLike,
} from "./mocks";

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
  artifacts: {
    trace: string | null;
    video: string | null;
    /** JPEG frames captured during the run, plus how to play them back. */
    frames?: { dir: string; count: number; fps: number };
  };
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
  /** Rules created for a run's mocks, deleted when it ends. */
  private readonly mockRules = new Map<string, string[]>();
  /** What those mocks were meant to do — checked against what actually happened. */
  private readonly mockPlans = new Map<string, MockPlan[]>();

  constructor(
    private readonly host: TrawlHost,
    private readonly agent: AgentClient,
  ) {}

  /** Reads a script the way the agent sees it — used to follow run('…') calls. */
  private readScript = async (path: string): Promise<string> =>
    (await this.agent.get<{ code: string }>("/scripts/read", { path })).code;

  /**
   * Mocks are Trawl rules, so they must exist before the browser makes its first
   * request — hence a tag chosen here rather than the runId the agent invents.
   */
  private async installMocks(
    input: StartInput,
    tag: string,
  ): Promise<{ ids: string[]; plans: MockPlan[]; warning: string | null }> {
    if (!this.host.rules.remove) return { ids: [], plans: [], warning: null }; // host older than 1.10.0

    const validation = await this.agent
      .post<{ steps: StepRecordLike[] }>("/scripts/validate", { code: input.code })
      .catch(() => null);
    const plans = collectMocks(validation?.steps ?? []);
    if (plans.length === 0) return { ids: [], plans, warning: null };

    const ids: string[] = [];
    for (const plan of plans) {
      ids.push(await this.host.rules.create(ruleDraft(plan, tag), { open: false }));
    }
    return {
      ids,
      plans,
      warning: approximateRanges(input.code, plans)
        ? "mock/unmock ranges are approximate: the script branches, so step indices are a static guess"
        : null,
    };
  }

  private async removeMocks(runId: string): Promise<void> {
    for (const id of this.mockRules.get(runId) ?? []) {
      await this.host.rules.remove?.(id).catch(() => {});
    }
    this.mockRules.delete(runId);
  }

  /** Subscribe first, then post: markers are only visible in the live stream. */
  async start(input: StartInput): Promise<RunReport> {
    const secrets = await resolveSecrets(this.host, await collectSecretNames(input.code, this.readScript));
    const correlator = new Correlator(this.host);
    correlator.start("");

    const tag = `tag_${Math.random().toString(36).slice(2, 10)}`;
    const mocks = await this.installMocks(input, tag);

    try {
      const report = await this.agent.post<RunReport>("/runs", {
        runTag: tag,
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
      this.mockRules.set(report.runId, mocks.ids);
      this.mockPlans.set(report.runId, mocks.plans);
      if (mocks.warning) report.warnings = [...(report.warnings ?? []), mocks.warning];
      this.reports.set(report.runId, report);
      this.host.events.emit("devices:run-started", {
        runId: report.runId,
        script: report.script,
        device: report.device,
      });
      return report;
    } catch (err) {
      correlator.stop();
      for (const id of mocks.ids) await this.host.rules.remove?.(id).catch(() => {});
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
      // Say so when a mock did nothing — a silently ignored mock reads as a
      // passing test that never exercised the case it claims to.
      const plans = this.mockPlans.get(runId) ?? [];
      if (plans.length) {
        merged.warnings = [...(merged.warnings ?? []), ...diagnoseMocks(plans, merged.steps ?? [])];
        this.mockPlans.delete(runId);
      }
      void this.removeMocks(runId);
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

  /** Replay up to a failure and ask the page what it offers now. */
  async heal(runId: string, deviceId: string): Promise<unknown> {
    return this.agent.post("/heal", {
      runId,
      deviceId,
      env: envSnapshot(this.host),
      proxyPort: (await this.host.capture?.status())?.port ?? undefined,
    });
  }

  report(runId: string): RunReport | undefined {
    return this.reports.get(runId);
  }

  async cancel(runId: string): Promise<{ cancelled: boolean }> {
    const result = await this.agent.del<{ cancelled: boolean }>(`/runs/${runId}`);
    await this.removeMocks(runId);
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
