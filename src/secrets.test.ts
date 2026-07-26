import { expect, it } from "vitest";
import { scanSecrets, resolveSecrets, envSnapshot, collectSecretNames } from "./secrets";
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

it("follows run('…') to collect secrets from composed scenarios", async () => {
  const files: Record<string, string> = {
    "scripts/login.js": "fill({label:'p'}, secret('PWD'))\nrun('scripts/otp.js')",
    "scripts/otp.js": "fill({label:'code'}, secret('OTP'))",
  };
  const read = async (path: string) => files[path] ?? Promise.reject(new Error("nope"));

  const names = await collectSecretNames("run('scripts/login.js')\nnote(secret('TOP'))", read);
  expect(names.sort()).toEqual(["OTP", "PWD", "TOP"]);
});

it("survives a run target that does not exist", async () => {
  const names = await collectSecretNames("run('scripts/gone.js')", async () => Promise.reject(new Error("404")));
  expect(names).toEqual([]);
});

it("does not loop forever on a cycle", async () => {
  const files: Record<string, string> = {
    "a.js": "run('b.js')\nnote(secret('A'))",
    "b.js": "run('a.js')\nnote(secret('B'))",
  };
  const names = await collectSecretNames("run('a.js')", async (p) => files[p]!);
  expect(names.sort()).toEqual(["A", "B"]);
});
