import { expect, it } from "vitest";
import { toNodes } from "./CanvasView";
import type { Row } from "./rows";

const row = (id: string, action: string, section?: string, arg?: string): Row => ({
  id,
  kind: "step",
  action,
  args: arg === undefined ? [] : [{ value: arg, literal: true }],
  ...(section ? { section } : {}),
  disabled: false,
  line: Number(id.slice(1)) + 1,
  raw: `${action}()`,
});

it("makes one node per section, keeping its steps together", () => {
  const nodes = toNodes([
    row("r0", "click", "Вход"),
    row("r1", "fill", "Вход"),
    row("r2", "click", "Подача"),
  ]);

  expect(nodes.map((n) => [n.kind, n.title, n.rows.length])).toEqual([
    ["section", "Вход", 2],
    ["section", "Подача", 1],
  ]);
});

it("gives a called scenario a node of its own", () => {
  const nodes = toNodes([row("r0", "run", undefined, "scripts/login.js"), row("r1", "click", "Подача")]);

  expect(nodes.map((n) => [n.kind, n.title])).toEqual([
    ["flow", "scripts/login.js"],
    ["section", "Подача"],
  ]);
});

it("collects steps outside any section into one block", () => {
  // Forty loose steps as forty nodes would be worse than a list in every way.
  const nodes = toNodes([row("r0", "goto"), row("r1", "click"), row("r2", "click", "Вход")]);

  expect(nodes.map((n) => [n.kind, n.rows.length])).toEqual([
    ["loose", 2],
    ["section", 1],
  ]);
});

it("starts a new block when a section comes back later", () => {
  const nodes = toNodes([row("r0", "click", "Вход"), row("r1", "goto"), row("r2", "click", "Вход")]);

  expect(nodes.map((n) => n.kind)).toEqual(["section", "loose", "section"]);
});
