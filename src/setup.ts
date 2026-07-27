/** The setup flow, kept free of React so it can be tested on its own. */

export type StepId = "capture" | "agent" | "browser" | "token" | "device" | "record";
export type StepStatus = "pending" | "running" | "done" | "failed";

export interface Step {
  id: StepId;
  label: string;
  status: StepStatus;
  detail?: string;
}

export const INITIAL_STEPS: Step[] = [
  { id: "capture", label: "Start capturing traffic", status: "pending" },
  { id: "agent", label: "Start the agent", status: "pending" },
  { id: "browser", label: "Install the browser", status: "pending" },
  { id: "token", label: "Connect to the agent", status: "pending" },
  { id: "device", label: "Create a device", status: "pending" },
  { id: "record", label: "Open the browser and record", status: "pending" },
];

export const setStep = (steps: Step[], id: StepId, status: StepStatus, detail?: string): Step[] =>
  steps.map((s) => (s.id === id ? { ...s, status, ...(detail === undefined ? {} : { detail }) } : s));

/** The agent prints `token: <value>` once on startup. */
export function extractToken(line: string): string | null {
  const hit = /^token:\s*(\S+)\s*$/.exec(line.trim());
  return hit ? hit[1]! : null;
}

/** `trawl-devices-agent 0.1.0 listening on http://127.0.0.1:8791` */
export function extractPort(line: string): number | null {
  const hit = /listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(line);
  return hit ? Number(hit[1]) : null;
}

/** `workspace: /Users/me/trawl-devices` */
export function extractWorkspace(line: string): string | null {
  const hit = /^workspace:\s*(.+?)\s*$/.exec(line.trim());
  return hit ? hit[1]! : null;
}

/** Progress lines the agent prints while Playwright downloads a browser. */
export const isBrowserLine = (line: string): boolean => line.startsWith("[browser]");
export const isBrowserReady = (line: string): boolean => /\[browser\].*(ready|skipping)/.test(line);

/**
 * Playwright frames some notices in box-drawing characters. Those belong in the
 * log, but showing them as a step's caption looks like breakage.
 */
export const isDecorative = (line: string): boolean => /[╔╚║═╗╝│─]/.test(line);

/** The caption shown next to a step, or null when the line is just noise. */
export function stepDetail(line: string): string | null {
  if (isDecorative(line)) return null;
  const text = line.replace(/^\[browser\]\s*/, "").trim();
  return text ? text.slice(0, 70) : null;
}

export interface AgentArgs {
  workspace?: string;
  port: number;
  /** Trawl's live proxy port — the browser is pointed at it. */
  proxyPort?: number;
}

/**
 * Insurance, not a fix: npx usually re-resolves `@latest`, but it can serve a
 * cached copy when the registry is slow or unreachable. Preferring the network
 * keeps a stale agent from starting silently.
 */
export const AGENT_ENV = { npm_config_prefer_online: "true" };

/** The command the plugin runs — also what the consent dialog shows. */
export function agentCommand(args: AgentArgs): { command: string; args: string[] } {
  return {
    command: "npx",
    args: [
      "-y",
      "trawl-devices-agent@latest",
      ...(args.workspace ? [`--workspace=${args.workspace}`] : []),
      `--port=${args.port}`,
      ...(args.proxyPort ? [`--proxy-port=${args.proxyPort}`] : []),
      "--ensure-browser",
    ],
  };
}

/** The device created when the registry is empty, so Record works immediately. */
export const DEFAULT_DEVICE = {
  id: "chrome-desktop",
  name: "Chrome desktop",
  browser: "chromium",
  headless: false,
  proxy: { mode: "trawl" },
};
