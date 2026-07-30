import type { AgentClient } from "./agent";

export interface RowArg {
  value: unknown;
  literal: boolean;
}

export interface Row {
  id: string;
  kind: "step" | "code";
  action?: string;
  args: RowArg[];
  section?: string;
  disabled: boolean;
  line: number;
  raw: string;
}

export type Command =
  | { kind: "remove"; id: string }
  | { kind: "setDisabled"; id: string; disabled: boolean }
  | { kind: "move"; id: string; before: string | null }
  | { kind: "setAction"; id: string; action: string }
  | { kind: "setArg"; id: string; index: number; value: unknown }
  | { kind: "insert"; before: string | null; action: string; args: unknown[]; section?: string }
  | { kind: "group"; ids: string[]; name: string }
  | { kind: "ungroup"; section: string }
  | { kind: "rename"; section: string; name: string }
  | { kind: "extract"; section: string; path?: string }
  | { kind: "moveSection"; section: string; before: string | null };

/**
 * Where to insert so the new row lands *after* the given line: the anchor is the
 * first row below it, and `null` means the end of the scenario. Used to put an
 * assertion right after the step whose traffic it was pinned from.
 */
export function anchorAfterLine(rows: Row[], line: number | null): string | null {
  if (line === null) return null;
  return rows.find((row) => row.line > line)?.id ?? null;
}

/** Parsing lives in the agent: the plugin never reads JavaScript. */
export class RowsClient {
  constructor(private readonly agent: AgentClient) {}

  async rows(code: string): Promise<Row[]> {
    return (await this.agent.post<{ rows: Row[] }>("/scripts/rows", { code })).rows;
  }

  async apply(code: string, command: Command): Promise<{ code: string; extracted?: { path: string } }> {
    return this.agent.post("/scripts/apply", { code, command });
  }
}
