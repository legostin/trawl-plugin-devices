import { expect, it } from "vitest";
import { loadSettings, saveSettings, loadToken, saveToken, DEFAULT_SETTINGS, TOKEN_SECRET_NAME } from "./settings";
import type { TrawlHost } from "./trawl";

const fakeHost = () => {
  const store = new Map<string, string>();
  const secrets = new Map<string, string>();
  return {
    storage: {
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => { store.set(k, v); },
    },
    secrets: {
      list: async () => [...secrets.keys()],
      get: async (n: string) => secrets.get(n) ?? null,
      set: async (n: string, v: string) => { secrets.set(n, v); },
    },
  } as unknown as TrawlHost;
};

it("returns defaults when nothing is stored", async () => {
  expect(await loadSettings(fakeHost())).toEqual(DEFAULT_SETTINGS);
});

it("merges a patch over the stored settings", async () => {
  const host = fakeHost();
  await saveSettings(host, { workspace: "/repo" });
  await saveSettings(host, { agentPort: 9000 });
  expect(await loadSettings(host)).toEqual({ ...DEFAULT_SETTINGS, workspace: "/repo", agentPort: 9000 });
});

it("survives corrupt stored JSON", async () => {
  const host = fakeHost();
  await host.storage.set("settings", "{not json");
  expect(await loadSettings(host)).toEqual(DEFAULT_SETTINGS);
});

it("stores the agent token in the Keychain, not in storage", async () => {
  const host = fakeHost();
  await saveSettings(host, { workspace: "/repo" });
  await saveToken(host, "tok_123");
  expect(await loadToken(host)).toBe("tok_123");
  // Storage holds real settings, and the token is not among them.
  expect(await host.storage.get("settings")).toContain("/repo");
  expect(await host.storage.get("settings")).not.toContain("tok_123");
  expect(await host.secrets.get(TOKEN_SECRET_NAME)).toBe("tok_123");
});
