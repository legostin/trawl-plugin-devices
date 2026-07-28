import { expect, it } from "vitest";
import { anchorAfterLine, type Row } from "./rows";

const row = (id: string, line: number): Row => ({
  id,
  kind: "step",
  action: "click",
  args: [],
  disabled: false,
  line,
  raw: "click('x')",
});

const ROWS = [row("r0", 1), row("r1", 2), row("r2", 5)];

it("anchors on the first row below the line", () => {
  expect(anchorAfterLine(ROWS, 1)).toBe("r1");
  // A step that spans lines 2..4: the next row is still the right anchor.
  expect(anchorAfterLine(ROWS, 3)).toBe("r2");
});

it("appends when the line is the last one", () => {
  expect(anchorAfterLine(ROWS, 5)).toBeNull();
  expect(anchorAfterLine(ROWS, 99)).toBeNull();
});

it("appends when the step had no line at all", () => {
  expect(anchorAfterLine(ROWS, null)).toBeNull();
});
