import type { Flow, TrawlHost } from "./trawl";

export interface FlowLink {
  flowId: number;
  method: string;
  url: string;
  status: number | null;
  ts: number;
  approx: boolean;
}

interface ReportShape {
  runId: string;
  steps: {
    index: number;
    startedAt: number;
    durationMs: number;
    flows: { method: string; url: string; status: number | null; flowId?: number; approx?: boolean }[];
  }[];
  warnings: string[];
}

export function readMarker(flow: Flow, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of flow.request?.headers ?? []) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

const flowUrl = (flow: Flow): string => {
  const { scheme, host, port, path } = flow.url;
  const authority =
    (scheme === "https" && port === 443) || (scheme === "http" && port === 80) ? host : `${host}:${port}`;
  return `${scheme}://${authority}${path}`;
};

/**
 * Subscribes to live traffic and maps marker headers to step indexes.
 * Marker headers exist only in the live stream — the persistent DB cannot
 * search headers — so `start()` must run before the run is posted.
 */
export class Correlator {
  private byStep = new Map<number, FlowLink[]>();
  private unseen: FlowLink[] = [];
  private unsubscribe: (() => void) | null = null;
  private runId = "";

  constructor(private readonly host: TrawlHost) {}

  start(runId: string): void {
    this.stop();
    this.runId = runId;
    this.byStep = new Map();
    this.unseen = [];
    this.unsubscribe = this.host.flows.subscribe((raw) => {
      try {
        this.ingest(raw as Flow);
      } catch {
        // Correlation is decoration: never let it escape into the run.
      }
    });
  }

  /** Re-target an already running subscription once the runId is known. */
  adopt(runId: string): void {
    this.runId = runId;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  linksFor(stepIndex: number): FlowLink[] {
    return this.byStep.get(stepIndex) ?? [];
  }

  private ingest(flow: Flow): void {
    const link: FlowLink = {
      flowId: flow.id,
      method: flow.method,
      url: flowUrl(flow),
      status: flow.response?.status ?? null,
      ts: flow.timestamp,
      approx: false,
    };

    const run = readMarker(flow, "x-trawl-run");
    const step = readMarker(flow, "x-trawl-step");
    if (run && this.runId && run !== this.runId) return;
    if (!run || step === null) {
      // No markers: keep it as a candidate for time-window matching.
      this.unseen.push({ ...link, approx: true });
      return;
    }

    const index = Number(step);
    if (!Number.isInteger(index)) return;
    const existing = this.byStep.get(index) ?? [];
    if (!existing.some((l) => l.flowId === link.flowId)) existing.push(link);
    this.byStep.set(index, existing);
  }

  /** Attach flowIds to the agent's report. Never throws. */
  merge<T extends ReportShape>(report: T): T {
    try {
      let usedApprox = false;
      for (const step of report.steps ?? []) {
        const exact = this.linksFor(step.index);
        for (const reported of step.flows ?? []) {
          const hit = exact.find(
            (l) => l.method === reported.method && l.url === reported.url && reported.flowId === undefined,
          );
          if (hit) {
            reported.flowId = hit.flowId;
            reported.approx = false;
            continue;
          }
          const from = step.startedAt;
          const to = step.startedAt + Math.max(step.durationMs, 0) + 1_000;
          const guess = this.unseen.find(
            (l) => l.method === reported.method && l.url === reported.url && l.ts >= from && l.ts <= to,
          );
          if (guess) {
            reported.flowId = guess.flowId;
            reported.approx = true;
            usedApprox = true;
          }
        }
      }
      if (usedApprox && !report.warnings.some((w) => w.includes("approx"))) {
        report.warnings.push("approx correlation used for some steps");
      }
    } catch {
      // Decoration only.
    }
    return report;
  }
}
