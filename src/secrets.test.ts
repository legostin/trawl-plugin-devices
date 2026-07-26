import { expect, it } from "vitest";
import { scanSecrets, resolveSecrets, envSnapshot } from "./secrets";
import type { TrawlHost } from "./trawl";

const host = (secrets: Record<string, string>, env: { key: string; value: string }[] = []) =>
  ({
    secrets: {
      get: async (n: string) => secrets[n] ?? null,
      list: async () => Object.keys(secrets),
      set: async () => {},
    },
    projects: { active: () => ({ id: "p1", name: "P", env }), onChange: () => () => {} },
  }) as unknown as TrawlHost;

it("finds every secret name a script asks for, once each", () => {
  const code = `fill({label:'p'}, secret('PWD'))\nnote(secret("API_KEY"))\nfill({label:'q'}, secret('PWD'))`;
  expect(scanSecrets(code).sort()).toEqual(["API_KEY", "PWD"]);
});

it("ignores secret-like text that is not a call", () => {
  expect(scanSecrets("note('mysecret(X)')")).toEqual([]);
});

it("resolves the named secrets and nothing else", async () => {
  const resolved = await resolveSecrets(host({ PWD: "p1", OTHER: "nope" }), ["PWD"]);
  expect(resolved).toEqual({ PWD: "p1" });
});

it("throws naming the secrets that are missing", async () => {
  await expect(resolveSecrets(host({ PWD: "p" }), ["PWD", "API_KEY"])).rejects.toThrow(/missing secrets: API_KEY/);
});

it("snapshots the active project's env", () => {
  expect(envSnapshot(host({}, [{ key: "BASE_URL", value: "https://app.test" }]))).toEqual({
    BASE_URL: "https://app.test",
  });
});

it("returns an empty env when no project is active", () => {
  const noProject = { projects: { active: () => null, onChange: () => () => {} } } as unknown as TrawlHost;
  expect(envSnapshot(noProject)).toEqual({});
});
