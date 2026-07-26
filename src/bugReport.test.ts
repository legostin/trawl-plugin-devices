import { expect, it } from "vitest";
import { bugReport } from "./bugReport";
import type { RunReport } from "./run";

const report: RunReport = {
  runId: "r_7f3a",
  script: "scripts/checkout.js",
  device: "chrome-desktop",
  status: "failed",
  startedAt: Date.UTC(2026, 6, 26, 12, 0, 0),
  durationMs: 8420,
  steps: [
    { index: 0, action: "goto", args: ["/cart"], status: "passed", startedAt: 1, durationMs: 5, flows: [] },
    {
      index: 1,
      action: "expectText",
      args: [{ testId: "total" }, "1 200 ₸"],
      status: "failed",
      startedAt: 2,
      durationMs: 3,
      flows: [{ method: "GET", url: "https://api.test/v1/cart", status: 500 }],
      error: { kind: "assertion", message: "text does not match", expected: "1 200 ₸", actual: "—" },
      screenshot: "step-01.png",
    },
  ],
  artifacts: { trace: "trace.zip", video: null, frames: { dir: "frames", count: 42, fps: 5 } },
  warnings: ["approx correlation used for some steps"],
};

it("leads with the verdict and the broken step", () => {
  const text = bugReport(report, { agentVersion: "0.10.0", env: { BASE_URL: "https://app.test" } });
  expect(text).toContain("# Failure: scripts/checkout.js");
  expect(text).toContain("**Result:** failed after 8420 ms");
  expect(text).toContain("**Device:** chrome-desktop");
  expect(text).toContain("**Agent:** 0.10.0");
  expect(text).toContain("BASE_URL=https://app.test");
  expect(text).toContain("Step 1 — `expectText`");
  expect(text).toContain("[assertion] text does not match");
  expect(text).toContain("expected: 1 200 ₸");
});

it("includes the network of the failing step — the first thing anyone asks", () => {
  expect(bugReport(report)).toContain("GET https://api.test/v1/cart → 500");
});

it("lists the steps with the failure marked", () => {
  const text = bugReport(report);
  expect(text).toContain('✓ goto("/cart")');
  expect(text).toContain("✗ expectText(");
});

it("points at the evidence on disk", () => {
  const text = bugReport(report, { workspace: "/repo" });
  expect(text).toContain("Screenshot: `/repo/runs/r_7f3a/step-01.png`");
  expect(text).toContain("Recording: `/repo/runs/r_7f3a/frames` (42 frames at 5 fps)");
  expect(text).toContain("Playwright trace: `/repo/runs/r_7f3a/trace.zip`");
});

it("carries the warnings, since they often explain the failure", () => {
  expect(bugReport(report)).toContain("- approx correlation used for some steps");
});

it("still reads sensibly for a passing run", () => {
  const passed = { ...report, status: "passed" as const, steps: [report.steps[0]!], warnings: [] };
  const text = bugReport(passed);
  expect(text).toContain("# Run: scripts/checkout.js");
  expect(text).not.toContain("## What broke");
});
