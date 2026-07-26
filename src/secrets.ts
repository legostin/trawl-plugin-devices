import type { TrawlHost } from "./trawl";

const CALL = /(?:^|[^A-Za-z0-9_$])secret\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;

/** Names a script passes to secret('…'). Only these are ever sent to the agent. */
export function scanSecrets(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(CALL)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

export async function resolveSecrets(host: TrawlHost, names: string[]): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = await host.secrets.get(name);
    if (value === null) missing.push(name);
    else resolved[name] = value;
  }
  if (missing.length) {
    throw new Error(`missing secrets: ${missing.join(", ")} — add them in Settings → Secrets`);
  }
  return resolved;
}

export function envSnapshot(host: TrawlHost): Record<string, string> {
  const project = host.projects.active();
  return Object.fromEntries((project?.env ?? []).map((e) => [e.key, e.value]));
}
