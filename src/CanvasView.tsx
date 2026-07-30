import { useState } from "react";
import type { TrawlHost } from "./trawl";
import type { Row, Command } from "./rows";
import type { ScreenFile } from "./MapView";
import { RowLine } from "./RowLine";

export interface CanvasNode {
  key: string;
  title: string;
  kind: "section" | "flow" | "loose";
  rows: Row[];
}

/**
 * Sections and flows as blocks. Steps are deliberately *not* nodes: forty of
 * them on a canvas is worse than a list in every way. This mode exists for what
 * a list cannot show — composition, reuse, and the shape of the scenario.
 */
export function toNodes(rows: Row[]): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  for (const row of rows) {
    if (row.section) {
      const last = nodes[nodes.length - 1];
      if (last?.kind === "section" && last.title === row.section) last.rows.push(row);
      else nodes.push({ key: `s:${row.section}`, title: row.section, kind: "section", rows: [row] });
      continue;
    }
    if (row.action === "run") {
      nodes.push({ key: `f:${row.id}`, title: String(row.args[0]?.value ?? "run"), kind: "flow", rows: [row] });
      continue;
    }
    const last = nodes[nodes.length - 1];
    if (last?.kind === "loose") last.rows.push(row);
    else nodes.push({ key: `l:${row.id}`, title: "", kind: "loose", rows: [row] });
  }
  return nodes;
}

export function CanvasView({
  host,
  rows,
  screens,
  scripts,
  onCommand,
  onPoint,
  selected,
  onSelect,
}: {
  host: TrawlHost;
  rows: Row[];
  screens: ScreenFile[];
  /** Every scenario in the workspace, to say how widely a flow is shared. */
  scripts: string[];
  onCommand: (command: Command) => void;
  onPoint: (before: string | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { Button } = host.ui;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [dragged, setDragged] = useState<CanvasNode | null>(null);
  const nodes = toNodes(rows);

  if (!nodes.length) {
    return (
      <div className="p-4 text-muted-foreground text-sm flex flex-col items-start gap-2">
        Nothing here yet.
        <Button size="sm" variant="ghost" onClick={() => onPoint(null)}>
          + point at a step in the browser
        </Button>
      </div>
    );
  }

  const drop = (node: CanvasNode | null): void => {
    if (!dragged) return;
    const before = node === null ? null : node.kind === "section" ? node.title : node.rows[0]!.id;
    if (dragged.kind === "section") {
      // A whole block moves, not its first step: that is the point of this mode.
      if (node?.kind === "section" || node === null) {
        onCommand({ kind: "moveSection", section: dragged.title, before: node?.title ?? null });
      }
    } else if (node?.kind !== "section") {
      onCommand({ kind: "move", id: dragged.rows[0]!.id, before: before as string | null });
    }
    setDragged(null);
  };

  const Edge = ({ node }: { node: CanvasNode | null }) => (
    <div
      className="h-6 w-px bg-border relative"
      onDragOver={(e) => e.preventDefault()}
      onDrop={() => drop(node)}
    >
      <button
        className="absolute -left-3 -top-0.5 text-muted-foreground hover:text-foreground"
        title="Add a step here by clicking it in the browser"
        onClick={() => onPoint(node ? node.rows[0]!.id : null)}
      >
        ＋
      </button>
    </div>
  );

  return (
    <div className="overflow-auto h-full p-4 flex flex-col items-center text-xs">
      {nodes.map((node, index) => {
        const expanded = open[node.key] ?? false;
        const holds = selected !== null && node.rows.some((r) => r.id === selected);
        const usedBy =
          node.kind === "flow" ? scripts.filter((s) => s !== node.title).length : 0;

        return (
          <div key={node.key} className="flex flex-col items-center w-full max-w-[560px]">
            {index > 0 && <Edge node={node} />}

            <div
              draggable={node.kind !== "loose"}
              onDragStart={() => setDragged(node)}
              onDragEnd={() => setDragged(null)}
              className={`w-full rounded border bg-background ${holds ? "border-primary" : "border-border"} ${
                dragged?.key === node.key ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  className="text-muted-foreground"
                  title={expanded ? "Collapse" : "Show the steps"}
                  onClick={() => setOpen((o) => ({ ...o, [node.key]: !expanded }))}
                >
                  {expanded ? "▾" : "▸"}
                </button>

                <span className="font-medium truncate">
                  {node.kind === "flow" ? `▸ ${node.title}` : node.title || "—"}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {node.rows.length} {node.rows.length === 1 ? "step" : "steps"}
                </span>
                {node.kind === "flow" && usedBy > 0 && (
                  <span
                    className="text-muted-foreground shrink-0"
                    title="Editing this scenario changes every scenario that calls it"
                  >
                    · shared
                  </span>
                )}

                {node.kind === "section" && (
                  <span className="ml-auto flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Turn this section into its own scenario, called from here"
                      onClick={() => onCommand({ kind: "extract", section: node.title })}
                    >
                      extract
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onCommand({ kind: "ungroup", section: node.title })}
                    >
                      ungroup
                    </Button>
                  </span>
                )}
              </div>

              {/* The expanded node renders the row component itself: one editor,
                  two arrangements. */}
              {expanded &&
                node.rows.map((row) => (
                  <RowLine
                    key={row.id}
                    host={host}
                    row={row}
                    screens={screens}
                    onCommand={onCommand}
                    selected={selected === row.id}
                    onSelect={() => onSelect(row.id)}
                  />
                ))}
            </div>
          </div>
        );
      })}

      <div className="w-full max-w-[560px] flex flex-col items-center">
        <Edge node={null} />
      </div>
    </div>
  );
}
