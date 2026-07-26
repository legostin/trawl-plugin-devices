import { useEffect, useState, type ReactNode } from "react";
import type { TrawlHost } from "./trawl";
import type { AgentClient } from "./agent";

/**
 * The DSL reference, served by the agent from the same SKILL.md that ships as a
 * Claude Code skill — one source, so the help here cannot drift from the one
 * agents read.
 */
export function GuideView({ host, agent }: { host: TrawlHost; agent: AgentClient }) {
  const [guide, setGuide] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void agent
      .get<{ guide: string }>("/guide")
      .then((r) => setGuide(r.guide))
      .catch((err) => setError((err as Error).message));
  }, [agent]);

  if (error) return <div className="p-3 text-xs text-destructive">{error}</div>;
  if (!guide) return <div className="p-3 text-xs text-muted-foreground">Loading the reference…</div>;

  return (
    <div className="p-3 overflow-auto h-full text-sm">
      {renderMarkdown(guide, host)}
    </div>
  );
}

/**
 * A deliberately small markdown subset — headings, code fences, lists, tables as
 * plain rows, inline code. Enough for the guide, and no dependency for a plugin
 * bundle that ships as one file.
 */
function renderMarkdown(source: string, host: TrawlHost) {
  const blocks: ReactNode[] = [];
  const lines = source.split("\n");
  let code: string[] | null = null;
  let list: string[] = [];

  const flushList = (): void => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 my-1 space-y-0.5">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (code) {
        blocks.push(
          <pre
            key={`code-${blocks.length}`}
            className="my-2 overflow-x-auto rounded border border-border bg-muted/30 p-2 font-mono text-xs"
          >
            {code.join("\n")}
          </pre>,
        );
        code = null;
      } else {
        flushList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }

    if (/^#{1,6} /.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      blocks.push(
        <div
          key={`h-${blocks.length}`}
          className={level <= 2 ? "font-semibold text-base mt-4 mb-1" : "font-semibold mt-3 mb-1"}
        >
          {inline(line.replace(/^#+\s*/, ""))}
        </div>,
      );
      continue;
    }

    if (/^\s*[-*] /.test(line)) {
      list.push(line.replace(/^\s*[-*]\s*/, ""));
      continue;
    }
    if (/^\s*\d+\. /.test(line)) {
      list.push(line.replace(/^\s*\d+\.\s*/, ""));
      continue;
    }

    flushList();
    if (line.trim()) {
      blocks.push(
        <p key={`p-${blocks.length}`} className="my-1 text-muted-foreground">
          {inline(line)}
        </p>,
      );
    }
  }
  flushList();
  void host; // the host is kept in the signature for future theming needs
  return blocks;
}

/** `code`, **bold** and plain text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      out.push(
        <code key={`c-${match.index}`} className="rounded bg-muted/50 px-1 font-mono text-xs">
          {match[1]}
        </code>,
      );
    } else if (match[2] !== undefined) {
      out.push(<strong key={`b-${match.index}`}>{match[2]}</strong>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
