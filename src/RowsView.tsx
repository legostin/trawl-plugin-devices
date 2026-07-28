import type { TrawlHost } from "./trawl";
import type { Row, Command } from "./rows";
import type { ScreenFile } from "./MapView";
import { RowLine } from "./RowLine";

/** The dense mode: forty steps on a screen, scanned at a glance. */
export function RowsView({
  host,
  rows,
  screens,
  onCommand,
  onPoint,
  selected,
  onSelect,
}: {
  host: TrawlHost;
  rows: Row[];
  screens: ScreenFile[];
  onCommand: (command: Command) => void;
  onPoint: (before: string | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { Button } = host.ui;

  if (!rows.length) {
    return (
      <div className="p-3 text-muted-foreground text-sm flex flex-col items-start gap-2">
        Nothing here yet.
        <Button size="sm" variant="ghost" onClick={() => onPoint(null)}>
          + point at a step in the browser
        </Button>
      </div>
    );
  }

  // Runs of rows sharing a section, in file order — the same grouping codegen
  // prints as step() blocks.
  const sections: { name?: string; rows: Row[] }[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last && last.name === row.section) last.rows.push(row);
    else sections.push({ name: row.section, rows: [row] });
  }

  return (
    <div className="overflow-auto h-full text-xs py-1">
      {sections.map((section, index) => (
        <div key={index}>
          {section.name && (
            <div className="px-2 py-1 text-muted-foreground flex items-center gap-2 border-t border-border/50">
              <span className="font-medium text-foreground">{section.name}</span>
              <Button
                size="sm"
                variant="ghost"
                title="Turn this section into its own scenario, called from here"
                onClick={() => onCommand({ kind: "extract", section: section.name! })}
              >
                extract
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Flatten it back into the scenario"
                onClick={() => onCommand({ kind: "ungroup", section: section.name! })}
              >
                ungroup
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                title="Open the browser and click it — the step lands here"
                onClick={() => onPoint(section.rows[0]!.id)}
              >
                + point here
              </Button>
            </div>
          )}
          {section.rows.map((row) => (
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
      ))}

      <div className="px-2 py-1 flex gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onCommand({ kind: "insert", before: null, action: "click", args: [""] })}
        >
          + step
        </Button>
        <Button size="sm" variant="ghost" title="Click it in the browser instead" onClick={() => onPoint(null)}>
          + point at the end
        </Button>
      </div>
    </div>
  );
}
