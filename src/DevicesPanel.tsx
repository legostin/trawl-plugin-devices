import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TrawlHost } from "./trawl";
import { AgentClient, type Health } from "./agent";
import { RunController, type RunReport } from "./run";
import { loadSettings, loadToken, saveSettings, saveToken, DEFAULT_SETTINGS, type Settings } from "./settings";
import { RunReportView } from "./RunReportView";
import { SetupPanel } from "./SetupPanel";
import {
  INITIAL_STEPS,
  setStep,
  agentCommand,
  extractPort,
  extractToken,
  extractWorkspace,
  isBrowserLine,
  isBrowserReady,
  stepDetail,
  DEFAULT_DEVICE,
  type Step,
} from "./setup";

interface Device {
  id: string;
  name: string;
  headless: boolean;
}

const MAX_LOG = 400;
const HEALTH_TIMEOUT_MS = 180_000;

export function makeDevicesPanel(host: TrawlHost) {
  return function DevicesPanel() {
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [token, setTokenState] = useState<string | null>(null);
    const [health, setHealth] = useState<Health | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [devices, setDevices] = useState<Device[]>([]);
    const [scripts, setScripts] = useState<string[]>([]);
    const [selectedScript, setSelectedScript] = useState("");
    const [code, setCode] = useState("");
    const [deviceId, setDeviceId] = useState("");
    const [report, setReport] = useState<RunReport | null>(null);
    const [recordingId, setRecordingId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [captureOn, setCaptureOn] = useState(true);
    const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
    const [log, setLog] = useState<string[]>([]);
    const [newDevice, setNewDevice] = useState<string | null>(null);
    const tokenRef = useRef<string | null>(null);

    const agent = useMemo(
      () => new AgentClient(host, () => ({ agentPort: settings.agentPort, token })),
      [settings.agentPort, token],
    );
    const runs = useMemo(() => new RunController(host, agent), [agent]);
    const ready = Boolean(health?.authenticated) && devices.length > 0;

    const loadEverything = useCallback(async (): Promise<Health> => {
      const fresh = await agent.health();
      setHealth(fresh);
      if (fresh.authenticated) {
        const listed = await agent.get<{ devices: Device[] }>("/devices");
        setDevices(listed.devices);
        setDeviceId((current) => current || listed.devices[0]?.id || "");
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
      }
      return fresh;
    }, [agent]);

    useEffect(() => {
      void (async () => {
        setSettings(await loadSettings(host));
        const stored = await loadToken(host);
        tokenRef.current = stored;
        setTokenState(stored);
      })();
      const offStart = host.events.on("capture:started", () => setCaptureOn(true));
      const offStop = host.events.on("capture:stopped", () => setCaptureOn(false));
      return () => {
        offStart();
        offStop();
      };
    }, []);

    // An agent may already be running from a previous session.
    useEffect(() => {
      void loadEverything().catch(() => setHealth(null));
    }, [loadEverything]);

    const guard = async (work: () => Promise<void>): Promise<void> => {
      setBusy(true);
      try {
        await work();
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    };

    const append = (text: string): void =>
      setLog((prev) => [...prev, text].slice(-MAX_LOG));

    /** Start the agent, wait for it to answer, and make sure a device exists. */
    const startSetup = () =>
      guard(async () => {
        if (!host.process) throw new Error("this Trawl version cannot start the agent");
        setLog([]);

        // Capture first: the browser is pointed at Trawl's proxy, and the agent
        // is told that port at startup.
        setSteps(setStep(INITIAL_STEPS, "capture", "running"));
        const capture = (await host.capture?.start()) ?? { running: false, port: null };
        const proxyPort = capture.port ?? settings.proxyPort;
        setSteps((s) =>
          setStep(
            s,
            "capture",
            capture.running ? "done" : "failed",
            capture.running ? `proxy on ${proxyPort}` : "the proxy did not start",
          ),
        );
        if (capture.port && capture.port !== settings.proxyPort) {
          void saveSettings(host, { proxyPort: capture.port }).then(setSettings);
        }

        setSteps((s) => setStep(s, "agent", "running"));
        const { command, args } = agentCommand({
          workspace: settings.workspace || undefined,
          port: settings.agentPort,
          proxyPort,
        });
        const proc = await host.process.spawn({ command, args });

        let livePort = settings.agentPort;
        const offOutput = host.process.onOutput(proc.id, ({ text }) => {
          append(text);
          if (isBrowserLine(text)) {
            const caption = stepDetail(text);
            setSteps((s) =>
              setStep(s, "browser", isBrowserReady(text) ? "done" : "running", caption ?? undefined),
            );
          }
          const found = extractToken(text);
          if (found) {
            tokenRef.current = found;
            setTokenState(found);
            void saveToken(host, found);
          }
          const port = extractPort(text);
          if (port) {
            livePort = port;
            setSteps((s) => setStep(s, "agent", "done", `port ${port}`));
            if (port !== settings.agentPort) void saveSettings(host, { agentPort: port }).then(setSettings);
          }
          const workspace = extractWorkspace(text);
          if (workspace) void saveSettings(host, { workspace }).then(setSettings);
        });
        const offExit = host.process.onExit(proc.id, ({ code }) => {
          if (code !== 0) setSteps((s) => setStep(s, "agent", "failed", `agent exited with ${code}`));
        });

        try {
          setSteps((s) => setStep(s, "token", "running"));
          const probe = new AgentClient(host, () => ({ agentPort: livePort, token: tokenRef.current }));
          const deadline = Date.now() + HEALTH_TIMEOUT_MS;
          let live: Health | null = null;
          while (Date.now() < deadline) {
            live = await probe.health().catch(() => null);
            if (live?.authenticated) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (!live?.authenticated) throw new Error("the agent did not answer in time — see the log");
          setSteps((s) => setStep(setStep(s, "browser", "done"), "token", "done", `agent ${live.agent}`));

          setSteps((s) => setStep(s, "device", "running"));
          const listed = await probe.get<{ devices: Device[] }>("/devices");
          const device = listed.devices[0] ?? (await probe.post<{ device: Device }>("/devices", DEFAULT_DEVICE)).device;
          setSteps((s) => setStep(s, "device", "done", device.name));

          setTokenState(tokenRef.current);
          await loadEverything();
          setDeviceId(device.id);

          // Straight into recording: a headed browser opens through the proxy
          // with the recorder overlay, so the next click is already captured.
          setSteps((s) => setStep(s, "record", "running"));
          const rec = await probe.post<{ id: string }>("/record/start", { deviceId: device.id });
          setRecordingId(rec.id);
          setSteps((s) => setStep(s, "record", "done", "browser open — click away, then Stop recording"));
        } catch (err) {
          setSteps((s) => setStep(s, "token", "failed", (err as Error).message));
          throw err;
        } finally {
          offOutput();
          offExit();
        }
      });

    const pickFolder = () =>
      guard(async () => {
        const picked = await host.dialog?.pickFolder({ title: "Where to keep scenarios" });
        if (picked) setSettings(await saveSettings(host, { workspace: picked }));
      });

    const openScript = (path: string) =>
      guard(async () => {
        setSelectedScript(path);
        if (path) setCode((await agent.get<{ code: string }>("/scripts/read", { path })).code);
      });

    const runScript = () =>
      guard(async () => {
        const started = await runs.start({ path: selectedScript || undefined, code, deviceId });
        setReport(started);
        setReport(await runs.waitFor(started.runId));
      });

    const startRecording = () =>
      guard(async () => {
        const started = await agent.post<{ id: string }>("/record/start", { deviceId });
        setRecordingId(started.id);
      });

    const stopRecording = () =>
      guard(async () => {
        if (!recordingId) return;
        const name = selectedScript || `scripts/recorded-${scripts.length + 1}.js`;
        const result = await agent.post<{ code: string; scriptPath?: string; warnings: string[] }>(
          `/record/${recordingId}/stop`,
          { saveAs: name },
        );
        setRecordingId(null);
        setCode(result.code);
        setSelectedScript(result.scriptPath ?? "");
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
        if (result.warnings.length) setError(result.warnings.join("; "));
      });

    const saveScript = () =>
      guard(async () => {
        const path = selectedScript || `scripts/script-${scripts.length + 1}.js`;
        await agent.post("/scripts/write", { path, code });
        setSelectedScript(path);
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
      });

    const addDevice = () =>
      guard(async () => {
        const name = (newDevice ?? "").trim();
        if (!name) return;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        await agent.post("/devices", { ...DEFAULT_DEVICE, id, name });
        setNewDevice(null);
        await loadEverything();
        setDeviceId(id);
      });

    const { Button, Select, ScriptEditor, Input } = host.ui;

    if (!ready) {
      const { command, args } = agentCommand({
        workspace: settings.workspace || undefined,
        port: settings.agentPort,
      });
      return (
        <SetupPanel
          host={host}
          steps={steps}
          log={log}
          busy={busy}
          workspace={health?.workspace ?? settings.workspace ?? null}
          canAutomate={Boolean(host.process)}
          command={[command, ...args].join(" ")}
          onStart={() => void startSetup()}
          onPickFolder={() => void pickFolder()}
          onToken={(value) =>
            void saveToken(host, value).then(() => {
              tokenRef.current = value;
              setTokenState(value);
              void loadEverything();
            })
          }
          tokenNeeded={!health?.authenticated}
        />
      );
    }

    return (
      <div className="flex flex-col h-full">
        <div className="flex gap-2 items-center p-2 border-b border-border flex-wrap">
          <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {newDevice === null ? (
            <Button variant="ghost" size="sm" onClick={() => setNewDevice("")} title="Add a device">
              ＋
            </Button>
          ) : (
            <span className="flex gap-1 items-center">
              <Input
                autoFocus
                value={newDevice}
                placeholder="device name"
                onChange={(e) => setNewDevice(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addDevice()}
                style={{ width: 160 }}
              />
              <Button size="sm" onClick={() => void addDevice()}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewDevice(null)}>
                Cancel
              </Button>
            </span>
          )}

          <Select value={selectedScript} onChange={(e) => void openScript(e.target.value)}>
            <option value="">— new script —</option>
            {scripts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>

          {recordingId ? (
            <Button disabled={busy} onClick={() => void stopRecording()}>
              Stop recording
            </Button>
          ) : (
            <Button disabled={busy || !deviceId} onClick={() => void startRecording()}>
              Record
            </Button>
          )}
          <Button disabled={busy || !code} onClick={() => void saveScript()}>
            Save
          </Button>
          <Button disabled={busy || !deviceId || !code} onClick={() => void runScript()}>
            Run
          </Button>

          <span className="ml-auto text-xs text-muted-foreground">
            agent {health?.agent} · {health?.workspace}
            {!captureOn && " · capture off: steps will have no traffic"}
          </span>
        </div>

        {recordingId && (
          <div className="px-2 py-1.5 text-xs border-b border-border bg-primary/10 flex items-center gap-2">
            <span className="text-primary">●</span>
            Recording — do things in the browser window, then press “Stop recording”. Every click lands in the
            script on the left.
          </div>
        )}

        {error && <div className="px-2 py-1 text-xs text-destructive border-b border-border">{error}</div>}

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 border-r border-border">
            <ScriptEditor value={code} onChange={setCode} language="javascript" />
          </div>
          <div className="w-[45%] min-w-0">
            <RunReportView host={host} report={report} />
          </div>
        </div>
      </div>
    );
  };
}
