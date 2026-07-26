import type * as React from "react";

export interface SendRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
  bodyB64?: string | null;
}

export interface SendResponse {
  status: number;
  headers: [string, string][];
  body: string;
  bodyIsText: boolean;
  durationMs: number;
  error: string | null;
}

export type Header = [name: string, value: string];

export interface HttpMessage {
  headers: Header[];
  body: number[] | string;
  bodyIsText: boolean;
}

export interface Flow {
  id: number;
  timestamp: number;
  method: string;
  url: { scheme: string; host: string; port: number; path: string };
  request: HttpMessage;
  response: { status: number; headers: Header[] } | null;
  state: "pending" | "completed" | "error" | "paused";
}

export interface McpToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => unknown | Promise<unknown>;
  /** Call timeout, ms (default 60000). */
  timeoutMs?: number;
}

export interface TrawlMcp {
  registerTool(spec: McpToolSpec): Promise<void>;
  unregisterTool(name: string): Promise<void>;
}

export interface EventMeta {
  description?: string;
  payloadType?: string;
  source?: string;
  params?: { name: string; type: string; doc?: string }[];
}

export interface ProcessInfo {
  id: string;
  pid: number;
  pluginId: string;
  command: string;
  startedAt: number;
}

export interface CaptureStatus {
  running: boolean;
  port: number | null;
}

export interface TrawlCapture {
  status(): CaptureStatus;
  start(): Promise<CaptureStatus>;
  stop(): Promise<void>;
  onChange(cb: (status: CaptureStatus) => void): () => void;
}

export interface ScriptEditorApi {
  insert(text: string): void;
  replaceAll(text: string): void;
  getSelectionText(): string;
  getValue(): string;
}

export interface CompletionItem {
  label: string;
  insert?: string;
  detail?: string;
  documentation?: string;
  kind?: "function" | "variable" | "file" | "snippet" | "keyword";
}

export interface TrawlEditor {
  registerCompletions(spec: {
    language?: string;
    triggerCharacters?: string[];
    provide(context: { linePrefix: string; text: string }): CompletionItem[];
  }): () => void;
}

export interface TrawlDialog {
  pickFolder(options?: { title?: string; defaultPath?: string }): Promise<string | null>;
  pickFile(options?: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string | null>;
}

export interface TrawlProcess {
  spawn(request: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<ProcessInfo>;
  onOutput(id: string, cb: (line: { stream: "stdout" | "stderr"; text: string }) => void): () => void;
  onExit(id: string, cb: (event: { code: number | null }) => void): () => void;
  kill(id: string): Promise<void>;
  list(): Promise<ProcessInfo[]>;
}

export interface RuleDraft {
  name: string;
  pattern: string;
  phase: "request" | "response" | "both" | "handler";
  script: string;
}

export interface TrawlRules {
  create(draft: RuleDraft, options?: { open?: boolean }): Promise<string>;
  /** Host API 1.10.0 and newer. */
  remove?(id: string): Promise<void>;
  list?(): Promise<unknown[]>;
}

export interface TrawlHost {
  version: string;
  react: typeof React;
  mcp?: TrawlMcp;
  /** Host API 1.8.0 and newer — always feature-detect. */
  capture?: TrawlCapture;
  editor?: TrawlEditor;
  dialog?: TrawlDialog;
  process?: TrawlProcess;
  events: {
    on(type: string, cb: (payload: unknown) => void): () => void;
    emit(type: string, payload?: unknown): void;
    describe(type: string, meta: EventMeta): void;
  };
  flows: { subscribe(cb: (flow: unknown) => void): () => void };
  rules: TrawlRules;
  http: { send(req: SendRequest, viaProxy?: boolean): Promise<SendResponse> };
  projects: {
    active(): { id: string; name: string; env: { key: string; value: string }[] } | null;
    onChange(cb: (p: unknown) => void): () => void;
  };
  secrets: {
    list(): Promise<string[]>;
    get(name: string): Promise<string | null>;
    set(name: string, value: string): Promise<void>;
  };
  storage: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> };
  ui: {
    ScriptEditor: React.ComponentType<{
      value: string;
      onChange: (v: string) => void;
      language?: string;
      apiRef?: React.MutableRefObject<ScriptEditorApi | null>;
    }>;
    Button: React.ComponentType<
      React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }
    >;
    Input: React.ComponentType<React.InputHTMLAttributes<HTMLInputElement>>;
    Select: React.ComponentType<React.SelectHTMLAttributes<HTMLSelectElement>>;
    StatusBadge: React.ComponentType<{ status: number | undefined; className?: string }>;
    MethodBadge: React.ComponentType<{ method: string; className?: string }>;
  };
  registerMode(mode: { id: string; label: string; component: React.ComponentType }): void;
  setMode(id: string): void;
  log(...args: unknown[]): void;
}

declare global {
  interface Window {
    __TRAWL__?: TrawlHost;
  }
}
