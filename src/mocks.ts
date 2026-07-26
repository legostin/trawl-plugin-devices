/**
 * Turns `mock(…)` steps into temporary Trawl rules.
 *
 * The mock is applied by the proxy rather than inside the browser, so the faked
 * exchange shows up in Trawl's traffic like any other flow — and it is scoped to
 * one run by the tag header that run's requests carry.
 */

export interface StepRecordLike {
  index: number;
  action: string;
  args: unknown[];
}

export interface MockResponse {
  status?: number;
  json?: unknown;
  text?: string;
  contentType?: string;
  delayMs?: number;
}

export interface MockMatcher {
  method?: string;
  urlPart?: string;
  host?: string;
  path?: string;
}

export interface MockPlan {
  matcher: MockMatcher;
  response: MockResponse;
  /** Step index the mock starts at, and where a matching unmock ends it. */
  from: number;
  to: number | null;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Same matcher syntax the HTTP assertions use, so there is one thing to learn. */
export function parseMatcher(input: unknown): MockMatcher {
  if (typeof input === "string") {
    const [head, ...rest] = input.trim().split(/\s+/);
    if (head && METHODS.includes(head.toUpperCase()) && rest.length) {
      return { method: head.toUpperCase(), urlPart: rest.join(" ") };
    }
    return { urlPart: input.trim() };
  }
  const raw = (input ?? {}) as Record<string, unknown>;
  return {
    ...(typeof raw.method === "string" ? { method: raw.method.toUpperCase() } : {}),
    ...(typeof raw.url === "string" ? { urlPart: raw.url } : {}),
    ...(typeof raw.host === "string" ? { host: raw.host } : {}),
    ...(typeof raw.path === "string" ? { path: raw.path } : {}),
  };
}

const sameMatcher = (a: MockMatcher, b: MockMatcher): boolean =>
  a.method === b.method && a.urlPart === b.urlPart && a.host === b.host && a.path === b.path;

/** Pair every `mock` with the `unmock` that closes it, if any. */
export function collectMocks(steps: StepRecordLike[]): MockPlan[] {
  const plans: MockPlan[] = [];
  for (const step of steps) {
    if (step.action === "mock") {
      plans.push({
        matcher: parseMatcher(step.args[0]),
        response: (step.args[1] ?? {}) as MockResponse,
        from: step.index,
        to: null,
      });
      continue;
    }
    if (step.action !== "unmock") continue;
    const matcher = parseMatcher(step.args[0]);
    const open = [...plans].reverse().find((p) => p.to === null && sameMatcher(p.matcher, matcher));
    if (open) open.to = step.index;
  }
  return plans;
}

const quote = (value: string): string => JSON.stringify(value);

/** The glob Trawl matches against `host + path`; the script re-checks exactly. */
export function rulePattern(matcher: MockMatcher): string {
  if (matcher.host && matcher.path) return `${matcher.host}${matcher.path}*`;
  if (matcher.host) return `${matcher.host}/*`;
  if (matcher.urlPart) return `*${matcher.urlPart}*`;
  return "*";
}

/**
 * A handler-phase rule: anything that is not this run's traffic, or is outside
 * the mock's step range, is passed through untouched.
 */
export function ruleScript(plan: MockPlan, tag: string): string {
  const lines = [
    `// Temporary mock created by the devices plugin — deleted when the run ends.`,
    `if (header(request, 'x-trawl-tag') !== ${quote(tag)}) return send(request);`,
  ];

  const step = plan.to === null ? `>= ${plan.from}` : `>= ${plan.from} && step < ${plan.to}`;
  lines.push(`const step = Number(header(request, 'x-trawl-step'));`);
  lines.push(`if (!(step ${step})) return send(request);`);

  if (plan.matcher.method) {
    lines.push(`if (request.method !== ${quote(plan.matcher.method)}) return send(request);`);
  }
  if (plan.matcher.urlPart) {
    lines.push(`if (!request.url.includes(${quote(plan.matcher.urlPart)})) return send(request);`);
  }
  if (plan.matcher.path) {
    lines.push(`if (!request.path.startsWith(${quote(plan.matcher.path)})) return send(request);`);
  }

  if (plan.response.delayMs) lines.push(`delay(${Math.round(plan.response.delayMs)});`);

  const { status, json, text, contentType } = plan.response;
  if (json !== undefined) {
    lines.push(`return json(${status ?? 200}, ${JSON.stringify(json)});`);
  } else if (text !== undefined) {
    lines.push(
      `return textResponse(${status ?? 200}, ${quote(text)}${contentType ? `, ${quote(contentType)}` : ""});`,
    );
  } else if (status !== undefined) {
    lines.push(
      status >= 400
        ? `return httpError(${status}, 'mocked by Trawl devices');`
        : `return textResponse(${status}, '');`,
    );
  } else {
    // Only a delay was asked for: the real response still comes back.
    lines.push(`return send(request);`);
  }

  return lines.join("\n") + "\n";
}

export interface RuleDraftLike {
  name: string;
  pattern: string;
  phase: "handler";
  script: string;
}

export function ruleDraft(plan: MockPlan, tag: string): RuleDraftLike {
  const what = [plan.matcher.method, plan.matcher.urlPart ?? plan.matcher.path ?? plan.matcher.host]
    .filter(Boolean)
    .join(" ");
  return {
    name: `mock ${what} (devices ${tag.slice(0, 8)})`,
    pattern: rulePattern(plan.matcher),
    phase: "handler",
    script: ruleScript(plan, tag),
  };
}

/** Step indices are only exact for a linear script — say so rather than pretend. */
export function approximateRanges(code: string, plans: MockPlan[]): boolean {
  const branches = /\b(if|for|while|switch)\b/.test(code);
  return branches && plans.some((p) => p.to !== null);
}

export interface FlowLike {
  method: string;
  url: string;
  status: number | null;
}

export interface StepWithFlows {
  index: number;
  flows: FlowLike[];
}

const flowMatches = (flow: FlowLike, matcher: MockMatcher): boolean => {
  if (matcher.method && flow.method.toUpperCase() !== matcher.method) return false;
  if (matcher.urlPart && !flow.url.includes(matcher.urlPart)) return false;
  if (matcher.host && !flow.url.includes(matcher.host)) return false;
  if (matcher.path && !flow.url.includes(matcher.path)) return false;
  return true;
};

const describePlan = (plan: MockPlan): string =>
  [plan.matcher.method, plan.matcher.urlPart ?? plan.matcher.path ?? plan.matcher.host]
    .filter(Boolean)
    .join(" ");

/**
 * A mock that quietly did nothing is worse than no mock at all. Two things stop
 * one from firing: nothing matched it, or the host lies outside the active
 * project — Trawl only applies rules to traffic it captures.
 */
export function diagnoseMocks(plans: MockPlan[], steps: StepWithFlows[]): string[] {
  const flows = steps.flatMap((step) => step.flows.map((flow) => ({ ...flow, step: step.index })));

  return plans.flatMap((plan) => {
    const inRange = (step: number): boolean => step >= plan.from && (plan.to === null || step < plan.to);
    const matched = flows.filter((flow) => inRange(flow.step) && flowMatches(flow, plan.matcher));

    if (matched.length === 0) {
      return [`mock ${describePlan(plan)} never matched a request`];
    }
    const wanted = plan.response.status;
    if (wanted !== undefined && matched.every((flow) => flow.status !== wanted)) {
      return [
        `mock ${describePlan(plan)} matched ${matched.length} request(s) but none returned ${wanted} — ` +
          `is that host inside the active project's scope? Trawl only applies rules to traffic it captures`,
      ];
    }
    return [];
  });
}
