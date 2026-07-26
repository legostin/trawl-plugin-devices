import type { TrawlHost } from "./trawl";

export interface ScenarioResult {
  script: string;
  runId: string | null;
  status: "pending" | "running" | "passed" | "failed" | "error";
  attempts: number;
  flaky: boolean;
  durationMs: number;
  failedStep?: { index: number; action: string; message?: string };
}

export interface SuiteReport {
  suiteId: string;
  name: string;
  status: "running" | "passed" | "failed";
  durationMs: number;
  results: ScenarioResult[];
}

const COLOUR: Record<ScenarioResult["status"], string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  passed: "text-green-500",
  failed: "text-destructive",
  error: "text-destructive",
};

/** The summary a regression run is actually read from: what passed, what did not, what wobbles. */
export function SuiteView({
  host,
  report,
  onOpenRun,
}: {
  host: TrawlHost;
  report: SuiteReport | null;
  onOpenRun: (runId: string) => void;
}) {
  const { Button } = host.ui;
  if (!report) return <div className="p-3 text-muted-foreground text-sm">No suite run yet.</div>;

  const passed = report.results.filter((r) => r.status === "passed").length;
  const flaky = report.results.filter((r) => r.flaky).length;

  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2 text-sm">
        <span className={report.status === "passed" ? "text-green-500" : "text-destructive"}>{report.status}</span>
        <span className="text-muted-foreground">
          {passed}/{report.results.length} passed
          {flaky > 0 && ` · ${flaky} flaky`} · {Math.round(report.durationMs / 100) / 10}s
        </span>
      </div>

      {report.results.map((result) => (
        <div key={result.script} className="border border-border rounded p-2 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={COLOUR[result.status]}>{result.status}</span>
            <span className="font-mono truncate">{result.script}</span>
            {result.flaky && (
              <span
                className="rounded bg-amber-500/20 px-1 text-amber-500"
                title="failed at least once, then passed — worth a look before it fails for real"
              >
                flaky
              </span>
            )}
            {result.attempts > 1 && <span className="text-muted-foreground">{result.attempts} attempts</span>}
            <span className="ml-auto text-muted-foreground">{result.durationMs} ms</span>
            {result.runId && (
              <Button size="sm" variant="ghost" onClick={() => onOpenRun(result.runId!)}>
                Open
              </Button>
            )}
          </div>
          {result.failedStep && (
            <div className="text-destructive">
              step {result.failedStep.index} ({result.failedStep.action}):{" "}
              {(result.failedStep.message ?? "").slice(0, 160)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
