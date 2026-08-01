import { useCallback, useEffect, useState } from "react";
import type { TrawlHost } from "./trawl";
import type { AgentClient } from "./agent";

export interface CoverageNode {
  id: string;
  label: string;
  usedBy: string[];
  elements: number;
}

export interface CoverageEdge {
  from: string;
  to: string;
  by: string[];
}

/**
 * Screens by layer: entry screens first, then whatever they lead to. A
 * breadth-first walk, because a graph library for a dozen boxes would be more
 * dependency than drawing.
 */
export function layers(nodes: CoverageNode[], edges: CoverageEdge[]): CoverageNode[][] {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const incoming = new Set(edges.map((e) => e.to));
  const outgoing = new Set(edges.map((e) => e.from));
  // An entry screen leads somewhere. A screen with no edges at all is not an
  // entry point, it is a screen nothing navigates through — and putting it in
  // the first row would hide exactly the thing worth seeing.
  const roots = nodes.filter((n) => !incoming.has(n.id) && outgoing.has(n.id));

  const out: CoverageNode[][] = [];
  const placed = new Set<string>();
  let level = roots.length ? roots : nodes.slice(0, 1);

  while (level.length) {
    const row = level.filter((n) => !placed.has(n.id));
    if (!row.length) break;
    row.forEach((n) => placed.add(n.id));
    out.push(row);
    level = edges
      .filter((e) => row.some((n) => n.id === e.from))
      .map((e) => byId.get(e.to))
      .filter((n): n is CoverageNode => Boolean(n) && !placed.has(n!.id));
  }

  // Anything the walk never reached is exactly the interesting part: a screen
  // no scenario navigates to.
  const unreached = nodes.filter((n) => !placed.has(n.id));
  if (unreached.length) out.push(unreached);
  return out;
}

/** What the suite covers, and what it does not. */
export function CoverageView({ host, agent }: { host: TrawlHost; agent: AgentClient }) {
  const { Button } = host.ui;
  const [data, setData] = useState<{ nodes: CoverageNode[]; edges: CoverageEdge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await agent.get<{ nodes: CoverageNode[]; edges: CoverageEdge[] }>("/map/coverage"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="p-3 text-destructive text-xs">{error}</div>;
  if (!data) return <div className="p-3 text-muted-foreground text-sm">Loading…</div>;
  if (!data.nodes.length) {
    return (
      <div className="p-3 text-muted-foreground text-sm">
        The map is empty — record something first, then run it. Coverage is built from runs that happened.
      </div>
    );
  }

  const untested = data.nodes.filter((n) => !n.usedBy.length);
  const fragile = data.edges.filter((e) => e.by.length === 1);
  const rows = layers(data.nodes, data.edges);
  const label = (id: string) => data.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">
          {data.nodes.length} screens · {data.edges.length} transitions
          {untested.length > 0 && <span className="text-amber-500"> · {untested.length} untested</span>}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-col items-center gap-1">
        {rows.map((row, index) => (
          <div key={index} className="flex flex-col items-center w-full">
            {index > 0 && <div className="h-4 w-px bg-border" />}
            <div className="flex flex-wrap justify-center gap-2">
              {row.map((node) => (
                <div
                  key={node.id}
                  className={`rounded border px-2 py-1 ${
                    node.usedBy.length ? "border-border" : "border-amber-500/60 bg-amber-500/10"
                  }`}
                  title={
                    node.usedBy.length
                      ? `Через этот экран ходят: ${node.usedBy.join(", ")}`
                      : "Через этот экран не ходит ни один сценарий"
                  }
                >
                  <div className="font-medium">{node.label}</div>
                  <div className="text-muted-foreground">
                    {node.elements} элем. ·{" "}
                    {node.usedBy.length ? `${node.usedBy.length} сцен.` : "не покрыт"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {fragile.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">
            Переходы, которые держит один сценарий — сломается он, и путь погаснет незаметно:
          </span>
          {fragile.map((edge) => (
            <div key={`${edge.from}-${edge.to}`} className="text-amber-500">
              {label(edge.from)} → {label(edge.to)} <span className="text-muted-foreground">({edge.by[0]})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
