import { useCallback, useEffect, useMemo, useState } from "react";
import type { TrawlHost } from "./trawl";
import { AgentClient, type Health } from "./agent";
import { RunController, type RunReport } from "./run";
import { loadSettings, loadToken, saveSettings, saveToken, DEFAULT_SETTINGS, type Settings } from "./settings";
import { SettingsBar } from "./SettingsBar";
import { RunReportView } from "./RunReportView";

interface Device {
  id: string;
  name: string;
  headless: boolean;
}

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

    const agent = useMemo(
      () => new AgentClient(host, () => ({ agentPort: settings.agentPort, token })),
      [settings.agentPort, token],
    );
    const runs = useMemo(() => new RunController(host, agent), [agent]);

    const refresh = useCallback(async () => {
      try {
        setHealth(await agent.health());
        const listed = await agent.get<{ devices: Device[] }>("/devices");
        setDevices(listed.devices);
        setDeviceId((current) => current || listed.devices[0]?.id || "");
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      }
    }, [agent]);

    useEffect(() => {
      void (async () => {
        setSettings(await loadSettings(host));
        setTokenState(await loadToken(host));
      })();
      const offStart = host.events.on("capture:started", () => setCaptureOn(true));
      const offStop = host.events.on("capture:stopped", () => setCaptureOn(false));
      return () => {
        offStart();
        offStop();
      };
    }, []);

    useEffect(() => {
      void refresh();
    }, [refresh]);

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
        const name = selectedScript || `scripts/recorded-${report?.runId ?? devices.length}-${scripts.length + 1}.js`;
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

    const { Button, Select, ScriptEditor } = host.ui;

    return (
      <div className="flex flex-col h-full">
        <SettingsBar
          host={host}
          settings={settings}
          health={health}
          healthError={error}
          captureOn={captureOn}
          onChange={(patch) => void saveSettings(host, patch).then(setSettings)}
          onToken={(value) =>
            void saveToken(host, value).then(() => {
              setTokenState(value);
              void refresh();
            })
          }
        />

        <div className="flex gap-2 items-center p-2 border-b border-border">
          <Select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.length === 0 && <option value="">no devices</option>}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
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
          {busy && <span className="text-xs text-muted-foreground">working…</span>}
        </div>

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
