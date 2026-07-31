import { expect, it } from "vitest";
import { explainRowsError } from "./RowsError";

it("an agent without the endpoint is an outdated agent, not an empty scenario", () => {
  const explained = explainRowsError("HTTP 404: unknown route POST /scripts/rows");
  expect(explained.title).toMatch(/не умеет/);
  expect(explained.hint).toContain("0.21.0");
  expect(explained.canRestart).toBe(true);
});

it("a scenario that does not parse says so, and points at the code tab", () => {
  const explained = explainRowsError("syntax error: Unexpected token (3:4)");
  expect(explained.title).toMatch(/не разбирается/);
  expect(explained.hint).toContain("code");
  // Restarting the agent would not help here, so it is not offered.
  expect(explained.canRestart).toBe(false);
});

it("anything else is shown as it came, rather than guessed at", () => {
  const explained = explainRowsError("connection refused");
  expect(explained.hint).toBe("connection refused");
  expect(explained.canRestart).toBe(false);
});
