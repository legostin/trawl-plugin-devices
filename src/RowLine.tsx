import type { TrawlHost } from "./trawl";
import type { Row, Command } from "./rows";
import type { ScreenFile } from "./MapView";

/** Steps a picker can offer; anything else keeps the action it already has. */
const ACTIONS = [
  "open", "goto", "click", "fill", "select", "check", "uncheck", "hover", "press",
  "expectVisible", "expectText", "expectUrl", "expectApi", "sleep", "run",
];

const TAKES_TARGET = new Set([
  "click", "fill", "select", "check", "uncheck", "hover", "expectVisible", "expectText",
]);

/** How many elements in the whole map answer to this label. */
const taken = (screens: ScreenFile[], label: string): number =>
  screens.reduce(
    (n, screen) => n + Object.values(screen.elements).filter((e) => e.label === label).length,
    0,
  );

/**
 * One row, in both modes: the list renders these in sequence, and an expanded
 * canvas node renders the very same component. One editor, two arrangements.
 */
export function RowLine({
  host,
  row,
  screens,
  onCommand,
  selected,
  onSelect,
}: {
  host: TrawlHost;
  row: Row;
  screens: ScreenFile[];
  onCommand: (command: Command) => void;
  selected: boolean;
  onSelect: () => void;
}) {
  const { Select, Input, Button } = host.ui;

  if (row.kind === "code") {
    return (
      <div
        className={`px-2 py-1 font-mono text-xs border-l-2 ${
          selected ? "border-primary bg-muted/40" : "border-transparent"
        } text-muted-foreground`}
        onClick={onSelect}
        title="Not a flat step — kept exactly as written, and edited in the code tab"
      >
        {row.raw}
      </div>
    );
  }

  // Grouped by screen rather than repeating it on every line: a screen named
  // after a marketing headline is otherwise the whole width of every option,
  // and the part that differs is the part pushed off the end.
  const groups = screens
    .map((screen) => ({
      screen: screen.label,
      items: Object.values(screen.elements).map((entry) => ({
        // A name unique in the whole map resolves on its own; only a repeated
        // one needs its screen, and that is what the recorder writes too.
        value: taken(screens, entry.label) > 1 ? `${screen.label} › ${entry.label}` : entry.label,
        label: entry.label,
        kind: entry.kind,
      })),
    }))
    .filter((g) => g.items.length > 0);

  const target = String(row.args[0]?.value ?? "");
  const references = groups.flatMap((g) => g.items);
  // The map knows an element is a set of choices but not which choices: the
  // options live on the page. A wrong value fails with the real list, which is
  // a better answer than a dropdown built from a guess.
  const isChoice = references.find((r) => r.value === target)?.kind === "choice";

  return (
    <div
      className={`flex items-center gap-1 px-2 py-0.5 border-l-2 ${
        selected ? "border-primary bg-muted/40" : "border-transparent"
      } ${row.disabled ? "opacity-40" : ""}`}
      onClick={onSelect}
    >
      <span className="text-muted-foreground w-6 shrink-0 text-right text-[10px]">{row.line}</span>

      <Select
        value={row.action}
        title="What this step does"
        onChange={(e) => onCommand({ kind: "setAction", id: row.id, action: e.target.value })}
        style={{ width: 120 }}
      >
        {!ACTIONS.includes(row.action ?? "") && <option value={row.action}>{row.action}</option>}
        {ACTIONS.map((action) => (
          <option key={action} value={action}>
            {action}
          </option>
        ))}
      </Select>

      {TAKES_TARGET.has(row.action ?? "") && row.args[0]?.literal ? (
        <Select
          value={target}
          title="An element from the map — the locator lives there, not here"
          onChange={(e) => onCommand({ kind: "setArg", id: row.id, index: 0, value: e.target.value })}
          style={{ width: 250 }}
        >
          {!references.some((r) => r.value === target) && <option value={target}>{target || "—"}</option>}
          {groups.map((group) => (
            <optgroup key={group.screen} label={group.screen}>
              {group.items.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      ) : (
        row.args[0] !== undefined && (
          <span className="font-mono text-xs truncate max-w-[250px]" title={String(row.args[0].value)}>
            {String(row.args[0].value ?? "")}
          </span>
        )
      )}

      {row.args.slice(1).map((argument, index) =>
        !argument.literal ? (
          <span
            key={index}
            className="font-mono text-xs text-muted-foreground"
            title="An expression — edit it in the code tab"
          >
            {String(argument.value)}
          </span>
        ) : (
          <Input
            key={index}
            defaultValue={String(argument.value ?? "")}
            title={isChoice ? "One of the options on the page" : "Value"}
            onBlur={(e) => {
              if (e.target.value !== String(argument.value ?? "")) {
                onCommand({ kind: "setArg", id: row.id, index: index + 1, value: e.target.value });
              }
            }}
            style={{ width: 150 }}
          />
        ),
      )}

      <span className="ml-auto flex gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          title={row.disabled ? "Take part in the run again" : "Keep it, but skip it"}
          onClick={() => onCommand({ kind: "setDisabled", id: row.id, disabled: !row.disabled })}
        >
          {row.disabled ? "◻" : "◼"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          title="Delete this step"
          onClick={() => onCommand({ kind: "remove", id: row.id })}
        >
          ✕
        </Button>
      </span>
    </div>
  );
}
