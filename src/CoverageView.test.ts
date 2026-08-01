import { expect, it } from "vitest";
import { layers, type CoverageEdge, type CoverageNode } from "./CoverageView";

const node = (id: string, usedBy: string[] = []): CoverageNode => ({ id, label: id, usedBy, elements: 1 });
const edge = (from: string, to: string): CoverageEdge => ({ from, to, by: ["a.js"] });

it("puts entry screens first and what they lead to below", () => {
  const rows = layers([node("main"), node("login"), node("done")], [edge("main", "login"), edge("login", "done")]);
  expect(rows.map((r) => r.map((n) => n.id))).toEqual([["main"], ["login"], ["done"]]);
});

it("shows a screen nothing navigates to rather than dropping it", () => {
  // The unreachable screen is the interesting part, not noise to hide.
  const rows = layers([node("main"), node("login"), node("orphan")], [edge("main", "login")]);
  expect(rows.at(-1)!.map((n) => n.id)).toEqual(["orphan"]);
});

it("does not loop forever on a cycle", () => {
  const rows = layers([node("a"), node("b")], [edge("a", "b"), edge("b", "a")]);
  expect(rows.flat().map((n) => n.id).sort()).toEqual(["a", "b"]);
});
