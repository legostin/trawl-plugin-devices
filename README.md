# Trawl Devices plugin

Test-automation devices for [Trawl](https://github.com/legostin/http-catch):
record a browser scenario, replay it with Playwright, and see each step next to
the HTTP traffic it caused.

## Requirements

The plugin is the UI and the MCP surface; the browser work happens in the
sidecar, [`trawl-devices-agent`](https://www.npmjs.com/package/trawl-devices-agent):

```sh
npx trawl-devices-agent@latest --workspace=/path/to/repo
npx playwright install chromium
```

The agent prints a bearer token — paste it once into the Devices tab.

## What it adds

- **Devices mode** — device list, script editor, run report with per-step HTTP.
- **20 MCP tools** (`devices_*`) — devices and sessions, recording, scripts and
  runs, live browser control, plus `devices_guide` with the DSL reference.
- **Step ↔ traffic correlation** — the agent marks every request with
  `x-trawl-run` / `x-trawl-step`, and the plugin matches those markers against
  Trawl's live capture, so a step in the report links to its captured flows.
- **Events** — `devices:run-started`, `devices:step-failed`,
  `devices:run-finished`; subscribe from the notifications plugin to get failed
  runs in Telegram.

## Settings

Workspace folder, agent port (8787) and Trawl's proxy port (8080) live in plugin
storage, per project. The agent token lives in the Keychain
(`TRAWL_DEVICES_AGENT_TOKEN`), never in plugin storage.

## Notes

- Correlation needs capture to be running; without it runs still work, steps
  just have no linked flows.
- Only the secrets a script actually names via `secret('X')` are sent to the
  agent, and they are masked in reports.
