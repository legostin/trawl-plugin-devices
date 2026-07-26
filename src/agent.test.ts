import { expect, it } from "vitest";
import { AgentClient, AGENT_MISSING_HINT } from "./agent";
import type { SendRequest, SendResponse, TrawlHost } from "./trawl";

const clientWith = (respond: (req: SendRequest) => SendResponse) => {
  const sent: SendRequest[] = [];
  const host = {
    http: {
      send: async (req: SendRequest) => {
        sent.push(req);
        return respond(req);
      },
    },
  } as unknown as TrawlHost;
  return { client: new AgentClient(host, () => ({ agentPort: 8787, token: "tok" })), sent };
};

const ok = (body: unknown): SendResponse => ({
  status: 200,
  headers: [],
  body: JSON.stringify(body),
  bodyIsText: true,
  durationMs: 1,
  error: null,
});

it("sends the bearer token and no Origin", async () => {
  const { client, sent } = clientWith(() => ok({ devices: [] }));
  await client.get("/devices");
  expect(sent[0]!.url).toBe("http://127.0.0.1:8787/devices");
  expect(sent[0]!.headers).toContainEqual(["authorization", "Bearer tok"]);
  expect(sent[0]!.headers.some(([k]) => k.toLowerCase() === "origin")).toBe(false);
});

it("serialises a POST body as JSON", async () => {
  const { client, sent } = clientWith(() => ok({ ok: true }));
  await client.post("/runs", { deviceId: "d1" });
  expect(sent[0]!.method).toBe("POST");
  expect(JSON.parse(sent[0]!.body)).toEqual({ deviceId: "d1" });
  expect(sent[0]!.headers).toContainEqual(["content-type", "application/json"]);
});

it("appends query parameters", async () => {
  const { client, sent } = clientWith(() => ok({ code: "" }));
  await client.get("/scripts/read", { path: "scripts/a b.js" });
  expect(sent[0]!.url).toBe("http://127.0.0.1:8787/scripts/read?path=scripts%2Fa+b.js");
});

it("turns a transport failure into the install hint", async () => {
  const { client } = clientWith(() => ({
    status: 0,
    headers: [],
    body: "",
    bodyIsText: true,
    durationMs: 0,
    error: "connection refused",
  }));
  await expect(client.get("/devices")).rejects.toThrow(AGENT_MISSING_HINT);
});

it("surfaces the agent's own error message and kind", async () => {
  const { client } = clientWith(() => ({
    status: 409,
    headers: [],
    bodyIsText: true,
    durationMs: 1,
    error: null,
    body: JSON.stringify({ error: { kind: "device", message: "unknown device: d1" } }),
  }));
  await expect(client.get("/devices")).rejects.toThrow("unknown device: d1");
});

it("reports the full health payload when authenticated", async () => {
  const { client } = clientWith(() => ok({ ok: true, agent: "0.1.0", dsl: 1, steps: ["goto"], workspace: "/repo" }));
  const health = await client.health();
  expect(health).toEqual({
    ok: true,
    agent: "0.1.0",
    dsl: 1,
    steps: ["goto"],
    workspace: "/repo",
    authenticated: true,
  });
});

it("treats a token-less health response as unauthenticated", async () => {
  const { client } = clientWith(() => ok({ ok: true, agent: "0.1.0" }));
  const health = await client.health();
  expect(health.authenticated).toBe(false);
});
