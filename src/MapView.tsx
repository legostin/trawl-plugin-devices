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
  /** A thumbnail of the element, relative to map/. */
  shot?: string;
  source: "recorded" | "ai" | "human";
  status: "proposed" | "accepted";
  updatedAt: string;
}

export interface ScreenFile {
  id: string;
  /** The application this screen belongs to. */
  domain?: string;
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
/** A pattern that names no host claims the whole site — see the agent's isTooBroad. */
const tooBroad = (pattern?: string): boolean => Boolean(pattern) && !/^[a-z]+:\/\//i.test(pattern!.trim());

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
  const [confirmScreen, setConfirmScreen] = useState<string | null>(null);
  /** A delete the agent refused because scenarios name this entry. */
  const [blocked, setBlocked] = useState<{ body: Record<string, unknown>; message: string } | null>(null);
  /** Thumbnails, fetched once each and kept as data urls. */
  const [shots, setShots] = useState<Record<string, string>>({});
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

  // A word cannot say which "Без названия" is which icon, so the picture is
  // fetched for every entry that has one — small, and once each.
  useEffect(() => {
    if (!screens) return;
    const wanted = screens
      .flatMap((screen) => Object.values(screen.elements))
      .map((entry) => entry.shot)
      .filter((shot): shot is string => Boolean(shot) && !(shot! in shots));
    for (const path of [...new Set(wanted)]) {
      void agent
        .get<{ png: string }>("/map/shot", { path })
        .then(({ png }) => setShots((all) => ({ ...all, [path]: `data:image/png;base64,${png}` })))
        .catch(() => {});
    }
  }, [screens, agent]);

  const edit = (body: Record<string, unknown>) =>
    agent
      .post("/map/edit", body)
      .then(() => {
        setBlocked(null);
        return load();
      })
      .catch((err: Error) => {
        // Scenarios naming this entry would start failing on resolution — at
        // run time, saying only that a name is not in the map. Offered as a
        // choice, with the list, rather than swallowed.
        if (/ссылаются/.test(err.message)) setBlocked({ body, message: err.message });
        else setError(err.message);
      });

  if (error) return <div className="p-3 text-destructive text-xs">{error}</div>;
  if (!screens) return <div className="p-3 text-muted-foreground text-sm">Loading…</div>;
  if (!screens.length) {
    return (
      <div className="p-3 text-muted-foreground text-sm">
        The map is empty. Record something — screens and elements are written as they are seen.
      </div>
    );
  }

  // Grouped by application: two products in one workspace are two maps that
  // happen to share a folder, and reading them as one list is confusing.
  const byDomain = [...
    screens.reduce((groups, screen) => {
      const key = screen.domain ?? "—";
      return groups.set(key, [...(groups.get(key) ?? []), screen]);
    }, new Map<string, ScreenFile[]>())
  ].sort(([a], [b]) => a.localeCompare(b));

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

      {blocked && (
        <div className="flex items-center gap-2 rounded border border-amber-500/60 bg-amber-500/10 px-2 py-1">
          <span>{blocked.message}</span>
          <span className="ml-auto flex gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => void edit({ ...blocked.body, force: true })}>
              Всё равно удалить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setBlocked(null)}>
              Отмена
            </Button>
          </span>
        </div>
      )}

      {byDomain.map(([domain, group]) => (
        <div key={domain} className="flex flex-col gap-2">
          {byDomain.length > 1 && (
            <div className="text-muted-foreground font-medium sticky top-0 bg-background py-1">{domain}</div>
          )}
          {group.map((screen) => {
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
              {editing === `m:${screen.id}` ? (
                <input
                  autoFocus
                  className="bg-transparent border-b border-border outline-none flex-1 font-mono"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => setEditing(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void edit({ screenId: screen.id, match: { url: draft } });
                      setEditing(null);
                    }
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <span
                  className={`truncate cursor-text font-mono ${
                    tooBroad(screen.match?.url) ? "text-amber-500" : "text-muted-foreground"
                  }`}
                  title={
                    tooBroad(screen.match?.url)
                      ? "Этот шаблон не привязан к хосту и забирает себе весь сайт. Нажмите, чтобы поправить."
                      : "Нажмите, чтобы поправить"
                  }
                  onClick={() => {
                    setEditing(`m:${screen.id}`);
                    setDraft(screen.match?.url ?? "");
                  }}
                >
                  {screen.match?.url ?? "—"}
                  {screen.match?.hash ? ` ${screen.match.hash}` : ""}
                </span>
              )}
              {!screen.open?.url && !screen.open?.flow && (
                <span className="text-amber-500 shrink-0" title="open('…') has nothing to navigate to">
                  no way in
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0"
                title="Удалить экран вместе со всеми его элементами"
                onClick={() => setConfirmScreen(screen.id)}
              >
                ✕
              </Button>
            </div>

            {confirmScreen === screen.id && (
              <div className="flex items-center gap-2 px-2 py-1 border-t border-border bg-amber-500/10">
                <span>
                  Удалить «{screen.label}» и {Object.keys(screen.elements).length} элемент(ов)? Сценарии,
                  которые на них ссылаются, перестанут находить эти имена.
                </span>
                <span className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void edit({ screenId: screen.id, remove: true });
                      setConfirmScreen(null);
                    }}
                  >
                    Удалить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmScreen(null)}>
                    Отмена
                  </Button>
                </span>
              </div>
            )}

            {expanded &&
              Object.entries(screen.elements).map(([key, entry]) => (
                <div key={key} className="flex items-baseline gap-2 px-2 py-1 border-t border-border/50">
                  <span
                    className={entry.status === "proposed" ? "text-amber-500" : "text-muted-foreground"}
                    title={`${entry.source}, ${entry.status}`}
                  >
                    {entry.status === "proposed" ? "⚠" : entry.kind === "choice" ? "≡" : "·"}
                  </span>

                  {entry.shot && shots[entry.shot] && (
                    <img
                      src={shots[entry.shot]}
                      alt=""
                      title="Как элемент выглядел при записи"
                      className="max-h-5 max-w-[120px] rounded border border-border object-contain bg-background"
                    />
                  )}

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
                    {screens.length > 1 && (
                      <select
                        className="bg-transparent border border-border rounded text-muted-foreground"
                        value=""
                        title="Перенести на другой экран"
                        onChange={(e) =>
                          e.target.value &&
                          void edit({ screenId: screen.id, elementKey: key, moveTo: e.target.value })
                        }
                      >
                        <option value="">→ экран</option>
                        {screens
                          .filter((other) => other.id !== screen.id)
                          .map((other) => (
                            <option key={other.id} value={other.id}>
                              {other.label}
                            </option>
                          ))}
                      </select>
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
      ))}
    </div>
  );
}
