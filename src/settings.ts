import type { TrawlHost } from "./trawl";

export interface Settings {
  /** Absolute path to the agent's workspace folder (scripts/, runs/, devices.json). */
  workspace: string;
  /** Where trawl-devices-agent listens. */
  agentPort: number;
  /** Trawl's own proxy port, handed to devices whose proxy mode is "trawl". */
  proxyPort: number;
}

export const DEFAULT_SETTINGS: Settings = { workspace: "", agentPort: 8787, proxyPort: 8080 };

const KEY = "settings";
export const TOKEN_SECRET_NAME = "TRAWL_DEVICES_AGENT_TOKEN";

export async function loadSettings(host: TrawlHost): Promise<Settings> {
  const raw = await host.storage.get(KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(host: TrawlHost, patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings(host)), ...patch };
  await host.storage.set(KEY, JSON.stringify(next));
  return next;
}

/** The agent's bearer token lives in the Keychain, never in plugin storage. */
export const loadToken = (host: TrawlHost): Promise<string | null> => host.secrets.get(TOKEN_SECRET_NAME);
export const saveToken = (host: TrawlHost, token: string): Promise<void> =>
  host.secrets.set(TOKEN_SECRET_NAME, token);
