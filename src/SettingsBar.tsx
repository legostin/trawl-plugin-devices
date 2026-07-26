import { useState } from "react";
import type { TrawlHost } from "./trawl";
import type { Health } from "./agent";
import type { Settings } from "./settings";

interface Props {
  host: TrawlHost;
  settings: Settings;
  health: Health | null;
  healthError: string | null;
  onChange: (patch: Partial<Settings>) => void;
  onToken: (token: string) => void;
  captureOn: boolean;
}

/** Workspace path, ports, token, and the two warnings that actually matter. */
export function SettingsBar({ host, settings, health, healthError, onChange, onToken, captureOn }: Props) {
  const { Input, Button } = host.ui;
  const [token, setToken] = useState("");

  return (
    <div className="border-b border-border p-3 flex flex-col gap-2">
      <div className="flex gap-2 items-center flex-wrap">
        <Input
          value={settings.workspace}
          placeholder="workspace folder (absolute path)"
          onChange={(e) => onChange({ workspace: e.target.value })}
          style={{ minWidth: 320 }}
        />
        <Input
          value={String(settings.agentPort)}
          onChange={(e) => onChange({ agentPort: Number(e.target.value) || 8787 })}
          style={{ width: 90 }}
          title="agent port"
        />
        <Input
          value={String(settings.proxyPort)}
          onChange={(e) => onChange({ proxyPort: Number(e.target.value) || 8080 })}
          style={{ width: 90 }}
          title="Trawl proxy port"
        />
        <span className="text-muted-foreground text-xs">
          {health ? `agent ${health.agent}${health.dsl ? ` · DSL v${health.dsl}` : ""}` : "agent: —"}
        </span>
      </div>

      {healthError && <div className="text-xs text-destructive">{healthError}</div>}

      {health && !health.authenticated && (
        <div className="flex gap-2 items-center">
          <Input value={token} placeholder="paste the agent token" onChange={(e) => setToken(e.target.value)} />
          <Button onClick={() => onToken(token)}>Save token</Button>
        </div>
      )}

      {!captureOn && (
        <div className="text-xs text-muted-foreground">
          Capture is stopped — runs will work, but steps will have no linked traffic.
        </div>
      )}
    </div>
  );
}
