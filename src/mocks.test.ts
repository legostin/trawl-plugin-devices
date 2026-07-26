import { expect, it } from "vitest";
import {
  collectMocks,
  parseMatcher,
  rulePattern,
  ruleScript,
  ruleDraft,
  approximateRanges,
  diagnoseMocks,
} from "./mocks";

const steps = [
  { index: 0, action: "goto", args: ["/"] },
  { index: 1, action: "mock", args: ["GET api/orders", { status: 500 }] },
  { index: 2, action: "click", args: [{ testId: "reload" }] },
  { index: 3, action: "unmock", args: ["GET api/orders"] },
  { index: 4, action: "mock", args: [{ host: "api.test", path: "/v1/me" }, { json: { id: 1 }, delayMs: 300 }] },
];

it("pairs a mock with the unmock that closes it", () => {
  const plans = collectMocks(steps);
  expect(plans).toHaveLength(2);
  expect(plans[0]).toMatchObject({ from: 1, to: 3, matcher: { method: "GET", urlPart: "api/orders" } });
  expect(plans[1]).toMatchObject({ from: 4, to: null, matcher: { host: "api.test", path: "/v1/me" } });
});

it("reads both matcher forms", () => {
  expect(parseMatcher("POST api/login")).toEqual({ method: "POST", urlPart: "api/login" });
  expect(parseMatcher("api/login")).toEqual({ urlPart: "api/login" });
  expect(parseMatcher({ method: "get", host: "api.test" })).toEqual({ method: "GET", host: "api.test" });
});

it("builds a pattern Trawl can match on host+path", () => {
  expect(rulePattern({ urlPart: "api/orders" })).toBe("*api/orders*");
  expect(rulePattern({ host: "api.test" })).toBe("api.test/*");
  expect(rulePattern({ host: "api.test", path: "/v1/me" })).toBe("api.test/v1/me*");
});

it("passes foreign traffic straight through", () => {
  const script = ruleScript(collectMocks(steps)[0]!, "tag_7f3a");
  expect(script).toContain("if (header(request, 'x-trawl-tag') !== \"tag_7f3a\") return send(request);");
  expect(script).toContain("if (!(step >= 1 && step < 3)) return send(request);");
  expect(script).toContain('if (request.method !== "GET") return send(request);');
  expect(script).toContain("return httpError(500, 'mocked by Trawl devices');");
});

it("serves a json body, delayed, when asked", () => {
  const script = ruleScript(collectMocks(steps)[1]!, "tag_1");
  expect(script).toContain("delay(300);");
  expect(script).toContain('return json(200, {"id":1});');
  expect(script).toContain("if (!(step >= 4)) return send(request);"); // no unmock: to the end
});

it("passes the real response through when only a delay is asked for", () => {
  const script = ruleScript({ matcher: { urlPart: "api/slow" }, response: { delayMs: 5000 }, from: 0, to: null }, "t");
  expect(script).toContain("delay(5000);");
  expect(script.trimEnd().endsWith("return send(request);")).toBe(true);
});

it("names the rule after what it mocks", () => {
  const draft = ruleDraft(collectMocks(steps)[0]!, "tag_7f3a5511");
  expect(draft.phase).toBe("handler");
  expect(draft.name).toBe("mock GET api/orders (devices tag_7f3a)");
  expect(draft.pattern).toBe("*api/orders*");
});

it("admits when step ranges can only be approximate", () => {
  const plans = collectMocks(steps);
  expect(approximateRanges("goto('/')\nmock('GET x')", plans)).toBe(false);
  expect(approximateRanges("if (a) { mock('GET x') }", plans)).toBe(true);
  // No unmock: nothing to be approximate about.
  expect(approximateRanges("if (a) { mock('GET x') }", [{ ...plans[1]! }])).toBe(false);
});

it("says when a mock never matched anything", () => {
  const plans = collectMocks([{ index: 1, action: "mock", args: ["GET api/orders", { status: 500 }] }]);
  const warnings = diagnoseMocks(plans, [{ index: 2, flows: [{ method: "GET", url: "https://x/other", status: 200 }] }]);
  expect(warnings).toEqual(["mock GET api/orders never matched a request"]);
});

it("says when requests matched but came back unmocked — the project-scope trap", () => {
  const plans = collectMocks([{ index: 0, action: "mock", args: ["GET api/orders", { status: 500 }] }]);
  const warnings = diagnoseMocks(plans, [
    { index: 1, flows: [{ method: "GET", url: "https://api.test/api/orders", status: 200 }] },
  ]);
  expect(warnings[0]).toContain("matched 1 request(s) but none returned 500");
  expect(warnings[0]).toContain("active project's scope");
});

it("stays quiet when the mock did its job", () => {
  const plans = collectMocks([{ index: 0, action: "mock", args: ["GET api/orders", { status: 500 }] }]);
  const warnings = diagnoseMocks(plans, [
    { index: 1, flows: [{ method: "GET", url: "https://api.test/api/orders", status: 500 }] },
  ]);
  expect(warnings).toEqual([]);
});
