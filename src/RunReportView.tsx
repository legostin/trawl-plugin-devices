import type { TrawlHost } from "./trawl";
import type { RunReport, StepReport } from "./run";

const statusColour = (status: StepReport["status"]): string =>
  status === "passed" ? "text-green-500" : status === "failed" ? "text-destructive" : "text-muted-foreground";

/** Steps with their HTTP flows; clicking a flow filters the Traffic view to it. */
export function RunReportView({ host, report }: { host: TrawlHost; report: RunReport | null }) {
  const { StatusBadge, MethodBadge } = host.ui;
  if (!report) return <div className="p-3 text-muted-foreground text-sm">No run yet.</div>;

  return (
    <div className="p-3 flex flex-col gap-2 overflow-auto h-full">
      <div className="flex gap-2 items-center">
        <span className={report.status === "passed" ? "text-green-500" : "text-destructive"}>{report.status}</span>
        <span className="text-muted-foreground text-xs">
          {report.durationMs} ms · {report.steps.length} steps
        </span>
      </div>

      {report.warnings.map((warning) => (
        <div key={warning} className="text-xs text-muted-foreground">
          ⚠ {warning}
        </div>
      ))}

      {report.steps.map((step) => (
        <div key={step.index} className="border border-border rounded p-2">
          <div className="flex gap-2 items-baseline">
            <span className={`text-xs ${statusColour(step.status)}`}>{step.status}</span>
            <span className="font-mono text-xs">
              {step.name ? `${step.name} › ` : ""}
              {step.action}({step.args.map((a) => JSON.stringify(a)).join(", ")})
            </span>
            <span className="text-muted-foreground text-xs ml-auto">{step.durationMs} ms</span>
          </div>

          {step.error && (
            <div className="text-xs text-destructive mt-1">
              [{step.error.kind}] {step.error.message}
              {step.error.expected !== undefined && (
                <div className="text-muted-foreground">
                  expected {step.error.expected} · actual {step.error.actual}
                </div>
              )}
            </div>
          )}

          {step.flows.map((flow, i) => (
            <div
              key={`${flow.url}-${i}`}
              className="text-xs flex gap-2 items-center mt-1 cursor-pointer"
              onClick={() => host.events.emit("filter:changed", { query: flow.url })}
              title={
                flow.flowId === undefined ? "not correlated" : flow.approx ? "approximate match" : "exact match"
              }
            >
              <MethodBadge method={flow.method} />
              <StatusBadge status={flow.status ?? undefined} />
              <span className="truncate">{flow.url}</span>
              {flow.approx && <span className="text-muted-foreground">≈</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
