import type { SendRequest, TrawlHost } from "./trawl";

export const AGENT_MISSING_HINT =
  "trawl-devices-agent is not reachable. Start it with: npx trawl-devices-agent@latest --workspace=<repo>";

export interface Health {
  ok: boolean;
  agent: string;
  /** Present only when the request carried a valid token. */
  dsl?: number;
  steps?: string[];
  workspace?: string;
  authenticated?: boolean;
}

export interface AgentConfig {
  agentPort: number;
  token: string | null;
}

/** Everything that talks to the sidecar goes through here. Errors carry a `kind`. */
export class AgentClient {
  constructor(
    private readonly host: TrawlHost,
    private readonly config: () => AgentConfig,
  ) {}

  get<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) search.set(key, String(value));
    }
    const suffix = search.toString() ? `?${search}` : "";
    return this.send<T>({ method: "GET", path: path + suffix });
  }

  post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.send<T>({ method: "POST", path, body });
  }

  del<T = unknown>(path: string): Promise<T> {
    return this.send<T>({ method: "DELETE", path });
  }

  async health(): Promise<Health> {
    const health = await this.get<Health>("/health");
    return { ...health, authenticated: health.dsl !== undefined };
  }

  private async send<T>(input: { method: string; path: string; body?: unknown }): Promise<T> {
    const { agentPort, token } = this.config();
    const headers: [string, string][] = [["authorization", `Bearer ${token ?? ""}`]];
    if (input.body !== undefined) headers.push(["content-type", "application/json"]);

    const request: SendRequest = {
      method: input.method,
      url: `http://127.0.0.1:${agentPort}${input.path}`,
      headers,
      body: input.body === undefined ? "" : JSON.stringify(input.body),
    };

    const response = await this.host.http.send(request, false);
    if (response.error || response.status === 0) throw new Error(AGENT_MISSING_HINT);

    let parsed: unknown = null;
    try {
      parsed = response.body ? JSON.parse(response.body) : null;
    } catch {
      throw new Error(`agent returned non-JSON (status ${response.status})`);
    }

    if (response.status >= 400) {
      const error = (parsed as { error?: { kind?: string; message?: string } })?.error;
      const message = error?.message ?? `agent error ${response.status}`;
      throw Object.assign(new Error(message), { kind: error?.kind ?? "agent" });
    }
    return parsed as T;
  }
}
