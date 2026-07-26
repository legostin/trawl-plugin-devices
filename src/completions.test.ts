import { expect, it } from "vitest";
import { completionsFor } from "./completions";

const sources = {
  steps: ["goto", "click", "expectText", "run"],
  scripts: ["scripts/login.js", "scripts/search.js"],
  variables: ["BASE_URL", "USER"],
};

it("offers scripts inside run('…')", () => {
  const items = completionsFor("run('", sources);
  expect(items.map((i) => i.label)).toEqual(["scripts/login.js", "scripts/search.js"]);
  expect(items[0]!.kind).toBe("file");
});

it("offers variables inside {{…}}", () => {
  const items = completionsFor("goto('{{BA", sources);
  expect(items.map((i) => i.label)).toEqual(["BASE_URL", "USER"]);
  expect(items[0]!.insert).toBe("BASE_URL}}");
});

it("offers steps everywhere else, with the caret inside the call", () => {
  const items = completionsFor("  ", sources);
  expect(items.map((i) => i.label)).toEqual(["goto", "click", "expectText", "run"]);
  expect(items.find((i) => i.label === "click")!.insert).toBe("click({ $0 })");
  expect(items.find((i) => i.label === "goto")!.insert).toBe("goto($0)");
  expect(items.find((i) => i.label === "run")!.insert).toBe("run('$0')");
  expect(items.find((i) => i.label === "expectText")!.detail).toContain("target");
});

it("does not mistake a finished run() call for a path position", () => {
  expect(completionsFor("run('scripts/login.js')", sources).map((i) => i.label)).toContain("goto");
});
