import { useState } from "react";
import type { TrawlHost } from "./trawl";
import type { Step } from "./setup";

const MARK: Record<Step["status"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  failed: "✕",
};

const COLOUR: Record<Step["status"], string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  done: "text-green-500",
  failed: "text-destructive",
};

interface Props {
  host: TrawlHost;
  steps: Step[];
  log: string[];
  busy: boolean;
  workspace: string | null;
  /** Absent on hosts older than 1.8.0 — then we can only show the command. */
  canAutomate: boolean;
  command: string;
  onStart: () => void;
  onPickFolder: () => void;
  onToken: (token: string) => void;
  tokenNeeded: boolean;
}

/** First-run screen: one button, then a checklist of what the app is doing. */
export function SetupPanel({
  host,
  steps,
  log,
  busy,
  workspace,
  canAutomate,
  command,
  onStart,
  onPickFolder,
  onToken,
  tokenNeeded,
}: Props) {
  const { Button, Input } = host.ui;
  const [showLog, setShowLog] = useState(false);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const failed = steps.find((s) => s.status === "failed");
  const started = steps.some((s) => s.status !== "pending");

  const copy = (): void => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  /** The command, with a copy icon — useful even when the app can start it
   *  itself: for a terminal run, a bug report, or CI. */
  const commandBlock = (
    <div className="flex items-start gap-2">
      <pre className="flex-1 overflow-x-auto rounded border border-border bg-muted/30 p-2 text-xs">
        {command}
      </pre>
      <button
        onClick={copy}
        title={copied ? "Copied" : "Copy command"}
        aria-label="Copy command"
        className="mt-1 shrink-0 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  );

  return (
    <div className="p-6 max-w-[720px] flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Set up device automation</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Trawl records what you do in a separate browser and replays it with Playwright. Everything runs on
          this machine.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Scenarios are kept in</span>
        <code className="rounded bg-muted/40 px-1.5 py-0.5 text-xs">
          {workspace ?? "~/trawl-devices"}
        </code>
        {host.dialog && (
          <Button variant="ghost" size="sm" onClick={onPickFolder} disabled={busy}>
            Change…
          </Button>
        )}
      </div>

      {canAutomate ? (
        <>
          <div>
            <Button onClick={onStart} disabled={busy}>
              {failed ? "Try again" : started ? "Running…" : "Start"}
            </Button>
          </div>

          <ol className="flex flex-col gap-1.5">
            {steps.map((step) => (
              <li key={step.id} className="text-sm flex gap-2 items-baseline">
                <span className={COLOUR[step.status]}>{MARK[step.status]}</span>
                <span className={step.status === "pending" ? "text-muted-foreground" : ""}>{step.label}</span>
                {step.detail && (
                  <span className={`text-xs ${step.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                    {step.detail}
                  </span>
                )}
              </li>
            ))}
          </ol>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">
              Command Trawl runs
            </summary>
            <div className="mt-2">{commandBlock}</div>
          </details>

          {log.length > 0 && (
            <div>
              <button
                className="text-xs text-muted-foreground underline"
                onClick={() => setShowLog((v) => !v)}
              >
                {showLog ? "Hide log" : `Show log (${log.length} lines)`}
              </button>
              {showLog && (
                <pre className="mt-2 max-h-[220px] overflow-auto rounded border border-border bg-muted/30 p-2 text-xs">
                  {log.join("\n")}
                </pre>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            This Trawl version cannot start the agent for you. Run it once in a terminal:
          </p>
          {commandBlock}
          {tokenNeeded && (
            <div className="flex gap-2 items-center mt-2">
              <Input
                value={token}
                placeholder="paste the token the command printed"
                onChange={(e) => setToken(e.target.value)}
              />
              <Button size="sm" onClick={() => onToken(token)}>
                Save
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
