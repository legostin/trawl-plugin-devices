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

const RUN_CALL = /(?:^|[^A-Za-z0-9_$])run\(\s*['"]([^'"]+)['"]/g;

/** Scripts a scenario pulls in via run('…'). */
export function scanRunTargets(code: string): string[] {
  const found = new Set<string>();
  for (const match of code.matchAll(RUN_CALL)) if (match[1]) found.add(match[1]);
  return [...found];
}

/**
 * Secrets used anywhere in a composed scenario. A script that only calls
 * run('scripts/login.js') names no secrets itself, yet the run needs login's.
 */
export async function collectSecretNames(
  code: string,
  readScript: (path: string) => Promise<string>,
): Promise<string[]> {
  const names = new Set(scanSecrets(code));
  const seen = new Set<string>();
  const queue = scanRunTargets(code);

  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const child = await readScript(next).catch(() => null);
    if (child === null) continue; // a missing script fails the run with its own error
    for (const name of scanSecrets(child)) names.add(name);
    queue.push(...scanRunTargets(child));
  }
  return [...names];
}

export function envSnapshot(host: TrawlHost): Record<string, string> {
  const project = host.projects.active();
  return Object.fromEntries((project?.env ?? []).map((e) => [e.key, e.value]));
}
