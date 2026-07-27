import { useCallback, useEffect, useState } from "react";
import type { TrawlHost } from "./trawl";
import type { AgentClient } from "./agent";

export interface ElementEntry {
  label: string;
  kind: "control" | "choice";
  aliases?: string[];
  target?: Record<string, unknown>;
  group?: Record<string, unknown>;
  option?: Record<string, unknown>;
  api?: string[];
  source: "recorded" | "ai" | "human";
  status: "proposed" | "accepted";
  updatedAt: string;
}

export interface ScreenFile {
  id: string;
  label: string;
  match: { url?: string; hash?: string } | null;
  open?: { url?: string; flow?: string };
  elements: Record<string, ElementEntry>;
}

/**
 * The application as the agent understands it. This is where a locator lives,
 * so this is where it gets fixed — one edit here is every scenario that walks
 * through the element.
 */
export function MapView({
  host,
  agent,
  onInsert,
}: {
  host: TrawlHost;
  agent: AgentClient;
  /** Put a reference into the script being edited. */
  onInsert?: (reference: string) => void;
}) {
  const { Button } = host.ui;
  const [screens, setScreens] = useState<ScreenFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showLocators, setShowLocators] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const load = useCallback(async () => {
    try {
      setScreens((await agent.get<{ screens: ScreenFile[] }>("/map")).screens);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [agent]);

  useEffect(() => {
    void load();
  }, [load]);

  const edit = (body: Record<string, unknown>) =>
    agent
      .post("/map/edit", body)
      .then(load)
      .catch((err: Error) => setError(err.message));

  if (error) return <div className="p-3 text-destructive text-xs">{error}</div>;
  if (!screens) return <div className="p-3 text-muted-foreground text-sm">Loading…</div>;
  if (!screens.length) {
    return (
      <div className="p-3 text-muted-foreground text-sm">
        The map is empty. Record something — screens and elements are written as they are seen.
      </div>
    );
  }

  const proposed = screens.reduce(
    (n, s) => n + Object.values(s.elements).filter((e) => e.status === "proposed").length,
    0,
  );

  return (
    <div className="p-3 overflow-auto h-full flex flex-col gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">
          {screens.length} screens · {screens.reduce((n, s) => n + Object.keys(s.elements).length, 0)} elements
          {proposed > 0 && <span className="text-amber-500"> · {proposed} need a name</span>}
        </span>
        <label className="ml-auto flex items-center gap-1 text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={showLocators} onChange={(e) => setShowLocators(e.target.checked)} />
          locators
        </label>
        <Button size="sm" variant="ghost" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {screens.map((screen) => {
        const expanded = open[screen.id] ?? true;
        return (
          <div key={screen.id} className="border border-border rounded">
            <div className="flex items-center gap-2 p-2">
              <button
                className="text-muted-foreground w-4 shrink-0"
                onClick={() => setOpen((o) => ({ ...o, [screen.id]: !expanded }))}
                title={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? "▾" : "▸"}
              </button>
              {editing === `s:${screen.id}` ? (
                <input
                  autoFocus
                  className="bg-transparent border-b border-border outline-none flex-1"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void edit({ screenId: screen.id, label: draft });
                      setEditing(null);
                    }
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span
                  className="font-medium cursor-text"
                  title="Click to rename"
                  onClick={() => {
                    setEditing(`s:${screen.id}`);
                    setDraft(screen.label);
                  }}
                >
                  {screen.label}
                </span>
              )}
              <span className="text-muted-foreground truncate" title={screen.match?.url ?? ""}>
                {screen.match?.url ?? ""}
                {screen.match?.hash ? ` ${screen.match.hash}` : ""}
              </span>
              {!screen.open?.url && !screen.open?.flow && (
                <span className="text-amber-500 shrink-0" title="open('…') has nothing to navigate to">
                  no way in
                </span>
              )}
            </div>

            {expanded &&
              Object.entries(screen.elements).map(([key, entry]) => (
                <div key={key} className="flex items-baseline gap-2 px-2 py-1 border-t border-border/50">
                  <span
                    className={entry.status === "proposed" ? "text-amber-500" : "text-muted-foreground"}
                    title={`${entry.source}, ${entry.status}`}
                  >
                    {entry.status === "proposed" ? "⚠" : entry.kind === "choice" ? "≡" : "·"}
                  </span>

                  {editing === `e:${screen.id}:${key}` ? (
                    <input
                      autoFocus
                      className="bg-transparent border-b border-border outline-none flex-1"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => setEditing(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          void edit({ screenId: screen.id, elementKey: key, label: draft });
                          setEditing(null);
                        }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <span
                      className="cursor-text"
                      title="Click to rename — the old name is kept, so scenarios keep working"
                      onClick={() => {
                        setEditing(`e:${screen.id}:${key}`);
                        setDraft(entry.label);
                      }}
                    >
                      {entry.label}
                    </span>
                  )}

                  {entry.api?.map((call) => (
                    <span key={call} className="text-muted-foreground font-mono">
                      {call}
                    </span>
                  ))}

                  {showLocators && (
                    <span className="text-muted-foreground font-mono truncate max-w-[50%]">
                      {JSON.stringify(entry.target ?? entry.group)}
                    </span>
                  )}

                  <span className="ml-auto flex gap-1 shrink-0">
                    {onInsert && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Put this reference into the script"
                        onClick={() => onInsert(`${screen.label} › ${entry.label}`)}
                      >
                        insert
                      </Button>
                    )}
                    {entry.status === "proposed" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Keep it as it is"
                        onClick={() => void edit({ screenId: screen.id, elementKey: key, status: "accepted" })}
                      >
                        accept
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Delete this entry"
                      onClick={() => void edit({ screenId: screen.id, elementKey: key, remove: true })}
                    >
                      ✕
                    </Button>
                  </span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
