import type { CompletionItem } from "./trawl";

/** Short help shown next to a step name. Anything missing falls back to "step". */
const DETAIL: Record<string, string> = {
  device: "device('id') — which device to run on",
  use: "use({ baseUrl, timeout })",
  goto: "goto(url)",
  click: "click(target)",
  fill: "fill(target, value)",
  type: "type(target, text)",
  press: "press(target, key)",
  check: "check(target)",
  uncheck: "uncheck(target)",
  select: "select(target, value)",
  hover: "hover(target)",
  upload: "upload(target, file)",
  drag: "drag(from, to)",
  scrollTo: "scrollTo(target)",
  waitFor: "waitFor(target, 'visible' | 'hidden' | 'attached')",
  waitForUrl: "waitForUrl(pattern)",
  waitForResponse: "waitForResponse('POST /api/x')",
  sleep: "sleep(ms) — prefer an assertion",
  expectVisible: "expectVisible(target)",
  expectHidden: "expectHidden(target)",
  expectText: "expectText(target, string | regex)",
  expectValue: "expectValue(target, value)",
  expectUrl: "expectUrl(pattern)",
  expectCount: "expectCount(target, n)",
  expectAttr: "expectAttr(target, name, value)",
  expectRequest: "expectRequest('POST /api/x')",
  expectResponse: "expectResponse('POST /api/x', { status: 200 })",
  expectNoRequest: "expectNoRequest('POST /api/x')",
  getText: "getText(target) → string",
  getValue: "getValue(target) → string",
  getAttr: "getAttr(target, name) → string",
  getUrl: "getUrl() → string",
  count: "count(target) → number",
  run: "run('scripts/login.js', { VAR: 'value' }) — compose scenarios",
  step: "step('name', () => { … }) — group steps",
  screenshot: "screenshot('name')",
  note: "note('text')",
};

/** Steps whose first argument is a target, so the snippet opens an object. */
const TARGET_FIRST = new Set([
  "click", "dblclick", "fill", "type", "check", "uncheck", "select", "hover", "upload",
  "scrollTo", "waitFor", "expectVisible", "expectHidden", "expectText", "expectValue",
  "expectCount", "expectAttr", "getText", "getValue", "getAttr", "count",
]);

export interface CompletionSources {
  /** Step names as reported by the agent's /health — never a hard-coded copy. */
  steps: string[];
  /** Script paths in the workspace, offered inside run('…'). */
  scripts: string[];
  /** Project variables, offered inside {{…}}. */
  variables: string[];
}

const insertFor = (name: string): string => {
  if (name === "run") return "run('$0')";
  if (TARGET_FIRST.has(name)) return `${name}({ $0 })`;
  return `${name}($0)`;
};

/**
 * What to offer at the caret. Deliberately driven by the line prefix only:
 * inside `run('` the answer is scripts, inside `{{` it is variables, and
 * otherwise it is the step vocabulary.
 */
export function completionsFor(linePrefix: string, sources: CompletionSources): CompletionItem[] {
  if (/run\(\s*['"][^'"]*$/.test(linePrefix)) {
    return sources.scripts.map((path) => ({
      label: path,
      kind: "file" as const,
      detail: "scenario",
    }));
  }

  if (/\{\{[A-Za-z0-9_]*$/.test(linePrefix)) {
    return sources.variables.map((name) => ({
      label: name,
      insert: `${name}}}`,
      kind: "variable" as const,
      detail: "project variable",
    }));
  }

  return sources.steps.map((name) => ({
    label: name,
    insert: insertFor(name),
    kind: "function" as const,
    detail: DETAIL[name] ?? "step",
  }));
}
