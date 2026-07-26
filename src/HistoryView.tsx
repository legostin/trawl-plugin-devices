import { useCallback, useEffect, useRef, useState } from "react";
import type { TrawlHost } from "./trawl";
import type { AgentClient } from "./agent";
import type { RunReport } from "./run";

const when = (ts: number): string => new Date(ts).toLocaleString();

/** Past runs of a scenario, with the frames each one recorded. */
export function HistoryView({
  host,
  agent,
  script,
  onOpen,
}: {
  host: TrawlHost;
  agent: AgentClient;
  script: string;
  onOpen: (report: RunReport) => void;
}) {
  const { Button } = host.ui;
  const [runs, setRuns] = useState<RunReport[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<RunReport | null>(null);

  const load = useCallback(async () => {
    try {
      const listed = await agent.get<{ runs: RunReport[] }>("/runs", script ? { script } : {});
      setRuns(listed.runs);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [agent, script]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm">{script ? `Runs of ${script}` : "All runs"}</span>
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {error && <div className="text-xs text-destructive">{error}</div>}
      {!error && runs.length === 0 && <div className="text-xs text-muted-foreground">No runs yet.</div>}

      {runs.map((run) => (
        <div key={run.runId} className="border border-border rounded p-2 text-xs flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={run.status === "passed" ? "text-green-500" : "text-destructive"}>{run.status}</span>
            <span className="text-muted-foreground">{when(run.startedAt)}</span>
            <span className="text-muted-foreground">{run.durationMs} ms</span>
            <span className="text-muted-foreground">{run.steps?.length ?? 0} steps</span>
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onOpen(run)}>
                Open report
              </Button>
              {run.artifacts?.frames && (
                <Button size="sm" variant="ghost" onClick={() => setPlaying(run)}>
                  ▶ {run.artifacts.frames.count} frames
                </Button>
              )}
            </span>
          </div>
          {playing?.runId === run.runId && <FramePlayer host={host} agent={agent} run={run} />}
        </div>
      ))}
    </div>
  );
}

/**
 * Plays a run's frames back at the rate they were captured. Frames arrive
 * base64 from the agent — the plugin has no filesystem — and are fetched lazily
 * so opening a long run does not pull megabytes at once.
 */
function FramePlayer({ host, agent, run }: { host: TrawlHost; agent: AgentClient; run: RunReport }) {
  const { Button } = host.ui;
  const frames = run.artifacts.frames!;
  const [index, setIndex] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const cache = useRef(new Map<number, string>());

  useEffect(() => {
    let cancelled = false;
    const name = `${frames.dir}/${String(index).padStart(5, "0")}.jpg`;
    const cached = cache.current.get(index);
    if (cached) {
      setSrc(cached);
      return;
    }
    void agent
      .get<{ mime: string; base64: string }>(`/runs/${run.runId}/artifact`, { path: name })
      .then((data) => {
        if (cancelled) return;
        const url = `data:${data.mime};base64,${data.base64}`;
        cache.current.set(index, url);
        setSrc(url);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
    };
  }, [agent, run.runId, frames.dir, index]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1 >= frames.count ? 0 : i + 1)),
      Math.round(1000 / Math.max(1, frames.fps)),
    );
    return () => clearInterval(timer);
  }, [playing, frames.count, frames.fps]);

  return (
    <div className="mt-1 flex flex-col gap-1">
      {src ? (
        <img src={src} alt={`frame ${index}`} className="w-full rounded border border-border" />
      ) : (
        <div className="h-40 flex items-center justify-center text-muted-foreground">loading frame…</div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setPlaying((p) => !p)}>
          {playing ? "⏸" : "▶"}
        </Button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.count - 1)}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
          className="flex-1"
        />
        <span className="text-muted-foreground tabular-nums">
          {index + 1}/{frames.count} · {frames.fps} fps
        </span>
      </div>
    </div>
  );
}
