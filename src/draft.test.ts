import { expect, it, beforeEach } from "vitest";
import { consumeDraft, proposeDraft, subscribeDraft } from "./draft";

beforeEach(() => void consumeDraft());

it("hands a draft to a panel that is already open", () => {
  const seen: string[] = [];
  const off = subscribeDraft((draft) => seen.push(draft.code));
  proposeDraft({ code: "click('A')\n", note: "проверь A" });
  off();

  expect(seen).toEqual(["click('A')\n"]);
});

it("keeps a draft proposed while the panel was closed", () => {
  proposeDraft({ code: "click('B')\n" });

  // Consumed on mount, so nothing an agent worked out is quietly lost.
  expect(consumeDraft()?.code).toBe("click('B')\n");
  expect(consumeDraft()).toBeNull();
});

it("stops delivering after unsubscribe", () => {
  const seen: string[] = [];
  subscribeDraft((d) => seen.push(d.code))();
  proposeDraft({ code: "click('C')\n" });
  expect(seen).toEqual([]);
});
