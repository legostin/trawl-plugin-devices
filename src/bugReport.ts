import type { RunReport, StepReport } from "./run";

/**
 * A failed run, written the way a bug report needs it: what was done, what
 * broke, what the network was doing at that moment, and where the evidence
 * sits. Pasted into a tracker it should need no follow-up questions.
 */

export interface BugReportContext {
  /** Where the run's artifacts live, so screenshots can be attached. */
  workspace?: string | null;
  agentVersion?: string | null;
  /** Project variables in force — often the difference between environments. */
  env?: Record<string, string>;
}

const stepLine = (step: StepReport): string => {
  const args = step.args.map((a) => JSON.stringify(a)).join(", ");
  const mark = step.status === "failed" ? "✗" : step.status === "skipped" ? "·" : "✓";
  return `${mark} ${step.name ? `${step.name} › ` : ""}${step.action}(${args})`;
};

const flowLine = (flow: StepReport["flows"][number]): string =>
  `${flow.method} ${flow.url} → ${flow.status ?? "no response"}`;

export function bugReport(report: RunReport, context: BugReportContext = {}): string {
  const failed = report.steps.find((s) => s.status === "failed");
  const lines: string[] = [];

  const kind = report.status === "passed" || report.status === "cancelled" ? "Run" : "Failure";
  lines.push(`# ${kind}: ${report.script ?? "inline scenario"}`);
  lines.push("");
  lines.push(`- **Result:** ${report.status} after ${report.durationMs} ms`);
  lines.push(`- **Device:** ${report.device}`);
  lines.push(`- **When:** ${new Date(report.startedAt).toISOString()}`);
  if (context.agentVersion) lines.push(`- **Agent:** ${context.agentVersion}`);
  if (context.env && Object.keys(context.env).length) {
    lines.push(`- **Variables:** ${Object.entries(context.env).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  if (failed) {
    lines.push("");
    lines.push("## What broke");
    lines.push("");
    lines.push(`Step ${failed.index} — \`${failed.action}\``);
    lines.push("");
    lines.push("```");
    lines.push(`[${failed.error?.kind ?? "error"}] ${failed.error?.message ?? "no message"}`);
    if (failed.error?.expected !== undefined) {
      lines.push(`expected: ${failed.error.expected}`);
      lines.push(`actual:   ${failed.error.actual}`);
    }
    lines.push("```");

    if (failed.flows.length) {
      lines.push("");
      lines.push("Network at that step:");
      lines.push("");
      for (const flow of failed.flows) lines.push(`- ${flowLine(flow)}`);
    }
  }

  lines.push("");
  lines.push("## Steps");
  lines.push("");
  lines.push("```");
  for (const step of report.steps) lines.push(stepLine(step));
  lines.push("```");

  const evidence: string[] = [];
  const runDir = context.workspace ? `${context.workspace}/runs/${report.runId}` : `runs/${report.runId}`;
  if (failed?.screenshot) evidence.push(`- Screenshot: \`${runDir}/${failed.screenshot}\``);
  if (report.artifacts.frames) {
    evidence.push(
      `- Recording: \`${runDir}/${report.artifacts.frames.dir}\` ` +
        `(${report.artifacts.frames.count} frames at ${report.artifacts.frames.fps} fps)`,
    );
  }
  if (report.artifacts.trace) evidence.push(`- Playwright trace: \`${runDir}/${report.artifacts.trace}\``);
  if (evidence.length) {
    lines.push("");
    lines.push("## Evidence");
    lines.push("");
    lines.push(...evidence);
  }

  if (report.warnings.length) {
    lines.push("");
    lines.push("## Warnings");
    lines.push("");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }

  return lines.join("\n") + "\n";
}
