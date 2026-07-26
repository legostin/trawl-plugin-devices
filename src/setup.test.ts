import { expect, it } from "vitest";
import {
  INITIAL_STEPS,
  setStep,
  extractToken,
  extractPort,
  extractWorkspace,
  isBrowserLine,
  isBrowserReady,
  agentCommand,
  stepDetail,
} from "./setup";

it("reads the token the agent prints", () => {
  expect(extractToken("token: soiW9nsL2DLx8RtqKun8SVjsSqt7pwyi")).toBe("soiW9nsL2DLx8RtqKun8SVjsSqt7pwyi");
  expect(extractToken("  token:abc123  ")).toBe("abc123");
  expect(extractToken("the token: is not here")).toBeNull();
  expect(extractToken("listening on http://127.0.0.1:8787")).toBeNull();
});

it("reads the port the agent actually took", () => {
  expect(extractPort("trawl-devices-agent 0.1.0 listening on http://127.0.0.1:8791")).toBe(8791);
  expect(extractPort("workspace: /tmp/x")).toBeNull();
});

it("reads the workspace the agent reports", () => {
  expect(extractWorkspace("workspace: /Users/me/trawl-devices")).toBe("/Users/me/trawl-devices");
  expect(extractWorkspace("token: abc")).toBeNull();
});

it("recognises browser progress lines", () => {
  expect(isBrowserLine("[browser] ensuring chromium is installed…")).toBe(true);
  expect(isBrowserReady("[browser] ensuring chromium is installed…")).toBe(false);
  expect(isBrowserReady("[browser] chromium ready")).toBe(true);
  expect(isBrowserReady("[browser] cannot locate the Playwright CLI; skipping chromium")).toBe(true);
  expect(isBrowserLine("token: abc")).toBe(false);
});

it("keeps Playwright's box-drawing noise out of step captions", () => {
  expect(stepDetail("[browser] ensuring chromium is installed…")).toBe("ensuring chromium is installed…");
  expect(stepDetail("[browser] ╔════════════════════╗")).toBeNull();
  expect(stepDetail("[browser] ║ WARNING: It looks like you are running… ║")).toBeNull();
  expect(stepDetail("[browser] ")).toBeNull();
  expect(stepDetail("[browser] chromium ready")).toBe("chromium ready");
});

it("builds the agent command, omitting an unset workspace", () => {
  expect(agentCommand({ port: 8787 })).toEqual({
    command: "npx",
    args: ["-y", "trawl-devices-agent@latest", "--port=8787", "--ensure-browser"],
  });
  expect(agentCommand({ port: 9000, workspace: "/repo" }).args).toContain("--workspace=/repo");
});

it("updates one step without touching the others", () => {
  const next = setStep(INITIAL_STEPS, "agent", "running");
  expect(next.find((s) => s.id === "agent")!.status).toBe("running");
  expect(next.filter((s) => s.status === "pending")).toHaveLength(3);

  const failed = setStep(next, "agent", "failed", "npx not found");
  expect(failed.find((s) => s.id === "agent")).toMatchObject({ status: "failed", detail: "npx not found" });
  expect(INITIAL_STEPS.every((s) => s.status === "pending")).toBe(true);
});
