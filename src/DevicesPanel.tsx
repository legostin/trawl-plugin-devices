import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScriptEditorApi, TrawlHost } from "./trawl";
import { AgentClient, type Health } from "./agent";
import { RunController, type RunReport } from "./run";
import { loadSettings, loadToken, saveSettings, saveToken, DEFAULT_SETTINGS, type Settings } from "./settings";
import { RunReportView } from "./RunReportView";
import { GuideView } from "./GuideView";
import { MapView, type ScreenFile } from "./MapView";
import { CoverageView } from "./CoverageView";
import { RowsView } from "./RowsView";
import { RowsError } from "./RowsError";
import { CanvasView } from "./CanvasView";
import { RowsClient, anchorAfterLine, type Row, type Command } from "./rows";
import { consumeDraft, subscribeDraft, type Draft } from "./draft";
import { HistoryView } from "./HistoryView";
import { completionsFor } from "./completions";
import { SuiteView, type SuiteReport } from "./SuiteView";
import { SetupPanel } from "./SetupPanel";
import {
  INITIAL_STEPS,
  setStep,
  agentCommand,
  AGENT_ENV,
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
  stepDelayMs?: number;
  closeAfterRun?: boolean;
  video?: boolean;
  videoFps?: number;
}

const MAX_LOG = 400;
const HEALTH_TIMEOUT_MS = 180_000;
/** How often the setup screen looks for an agent that has appeared. */
const AGENT_POLL_MS = 2_000;

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
    /** What the selected script looks like on disk — composition reads that. */
    const [savedCode, setSavedCode] = useState("");
    const [deviceId, setDeviceId] = useState("");
    const [report, setReport] = useState<RunReport | null>(null);
    const [recordingId, setRecordingId] = useState<string | null>(null);
    const [recordingPaused, setRecordingPaused] = useState(false);
    const [runPaused, setRunPaused] = useState(false);
    const [mode, setMode] = useState<"rows" | "canvas" | "code">("rows");
    const [rows, setRows] = useState<Row[]>([]);
    /** Why the rows are not there — never left to look like an empty scenario. */
    const [rowsError, setRowsError] = useState<string | null>(null);
    /** A scenario an agent proposed, not yet saved by anyone. */
    const [draft, setDraft] = useState<Draft | null>(null);
    /** A delete the agent refused because other scenarios call this one. */
    const [deleteBlocked, setDeleteBlocked] = useState<{ path: string; message: string } | null>(null);
    const [screens, setScreens] = useState<ScreenFile[]>([]);
    const [selectedRow, setSelectedRow] = useState<string | null>(null);
    /** Set while a recording is being used to add a step at a given row. */
    const [pointingAt, setPointingAt] = useState<{ before: string | null } | null>(null);
    const [busy, setBusy] = useState(false);
    const [captureOn, setCaptureOn] = useState(true);
    const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
    const [log, setLog] = useState<string[]>([]);
    const [newDevice, setNewDevice] = useState<string | null>(null);
    const [scriptName, setScriptName] = useState("");
    const [pane, setPane] = useState<"report" | "map" | "coverage" | "suite" | "history" | "guide">("report");
    const [suites, setSuites] = useState<string[]>([]);
    const [selectedSuite, setSelectedSuite] = useState("");
    const [openSessions, setOpenSessions] = useState<{ sessionId: string; currentUrl: string | null }[]>([]);
    /** "" means a fresh browser; otherwise continue in that open one. */
    const [sessionId, setSessionId] = useState("");
    /** Set while recording the missing steps for a failed run. */
    const [continuationLine, setContinuationLine] = useState<number | null>(null);
    const [suiteReport, setSuiteReport] = useState<SuiteReport | null>(null);
    const editorRef = useRef<ScriptEditorApi | null>(null);
    const [reportWidth, setReportWidth] = useState(45); // percent
    const dragging = useRef(false);
    const tokenRef = useRef<string | null>(null);

    const agent = useMemo(
      () => new AgentClient(host, () => ({ agentPort: settings.agentPort, token })),
      [settings.agentPort, token],
    );
    const runs = useMemo(() => new RunController(host, agent), [agent]);
    const rowsClient = useMemo(() => new RowsClient(agent), [agent]);
    const ready = Boolean(health?.authenticated) && devices.length > 0;

    const loadEverything = useCallback(async (): Promise<Health> => {
      const fresh = await agent.health();
      setHealth(fresh);
      if (fresh.authenticated) {
        const listed = await agent.get<{
          devices: Device[];
          sessions?: { sessionId: string; currentUrl: string | null }[];
        }>("/devices");
        setDevices(listed.devices);
        const live = listed.sessions ?? [];
        setOpenSessions(live);
        // A browser the human closed is gone from the agent but still selected
        // here; keeping it means the next Record aims at a window that is not
        // there any more.
        setSessionId((current) => (current && !live.some((s) => s.sessionId === current) ? "" : current));
        setDeviceId((current) => current || listed.devices[0]?.id || "");
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
        // Older agents have no suites endpoint; an empty list simply hides the UI.
        setSuites((await agent.get<{ suites: string[] }>("/suites").catch(() => ({ suites: [] }))).suites);
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
      // A draft proposed while this panel was closed is waiting; one proposed
      // while it is open arrives through the subscription.
      const takeDraft = (proposed: Draft): void => {
        setDraft(proposed);
        setCode(proposed.code);
        editorRef.current?.replaceAll(proposed.code);
        setSelectedScript("");
        setSavedCode("");
        if (proposed.suggestedPath) {
          setScriptName(proposed.suggestedPath.replace(/^scripts\//, "").replace(/\.js$/, ""));
        }
      };
      const waiting = consumeDraft();
      if (waiting) takeDraft(waiting);
      const offDraft = subscribeDraft(takeDraft);

      const offStart = host.events.on("capture:started", () => setCaptureOn(true));
      const offStop = host.events.on("capture:stopped", () => setCaptureOn(false));
      return () => {
        offDraft();
        offStart();
        offStop();
      };
    }, []);

    // Point at the line a run died on: reading a stack trace to find your place
    // in your own script is work the tool should do.
    useEffect(() => {
      const failed = report?.steps.find((s) => s.status === "failed");
      editorRef.current?.highlightLines?.(failed?.line ? [failed.line] : []);
    }, [report]);

    // The editor learns this plugin's language: steps from the agent (never a
    // hard-coded copy), script paths for run('…'), project variables for {{…}}.
    useEffect(() => {
      if (!host.editor) return;
      const off = host.editor.registerCompletions({
        language: "javascript",
        triggerCharacters: ["'", '"', "{", "("],
        provide: ({ linePrefix }) =>
          completionsFor(linePrefix, {
            steps: health?.steps ?? [],
            scripts,
            variables: (host.projects.active()?.env ?? []).map((v) => v.key),
          }),
      });
      return off;
    }, [health?.steps, scripts]);

    // An agent may already be running from a previous session.
    useEffect(() => {
      void loadEverything().catch(() => setHealth(null));
    }, [loadEverything]);

    // While the setup screen is up, watch for an agent appearing. On a host that
    // cannot spawn it, the only way in is to run the command by hand — and then
    // sitting on a screen that never notices is the whole of the experience.
    useEffect(() => {
      if (ready) return;
      const id = setInterval(() => {
        void loadEverything().catch(() => {});
      }, AGENT_POLL_MS);
      return () => clearInterval(id);
    }, [ready, loadEverything]);

    // The rows are a view of the code, which stays the single source of truth —
    // so the code tab keeps working exactly as it did.
    useEffect(() => {
      if (mode === "code" || !health?.authenticated) return;
      let cancelled = false;
      void rowsClient.rows(code).then(
        (fresh) => {
          if (cancelled) return;
          setRows(fresh);
          setRowsError(null);
        },
        (err: Error) => {
          if (cancelled) return;
          // An empty list must never stand in for "this did not work": the
          // scenario is right there in the code tab, and saying nothing about
          // why it is not shown is the worst of the three answers.
          setRows([]);
          setRowsError(err.message);
        },
      );
      return () => {
        cancelled = true;
      };
    }, [code, mode, health?.authenticated, rowsClient]);

    // The element pickers are the map; without it a row can only show the text
    // it already has.
    useEffect(() => {
      if (!health?.authenticated) return;
      void agent
        .get<{ screens: ScreenFile[] }>("/map")
        .then((map) => setScreens(map.screens))
        .catch(() => setScreens([]));
    }, [health?.authenticated, agent, recordingId]);

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

    /**
     * Replace whatever agent is running with a fresh one. Needed more often
     * than it sounds: an agent left from an earlier session keeps its old
     * version, and half the vocabulary silently does not exist.
     */
    const restartAgent = () =>
      guard(async () => {
        if (!host.process) throw new Error("this Trawl version cannot start the agent");
        setLog([]);
        // The new agent knows nothing of the old one's recordings and browsers.
        // Holding on to their ids is how the panel ends up offering "Stop
        // recording" for a recording that no longer exists anywhere.
        setRecordingId(null);
        setRecordingPaused(false);
        setSessionId("");
        setContinuationLine(null);
        setSteps(setStep(INITIAL_STEPS, "agent", "running", "stopping the old agent"));

        // Ask it to quit — this also reaches an agent this plugin never spawned.
        await agent.post("/shutdown", {}).catch(() => {});
        for (const proc of await host.process.list()) await host.process.kill(proc.id).catch(() => {});
        await new Promise((r) => setTimeout(r, 700));

        const capture = await host.capture?.start();
        const proxyPort = capture?.port ?? settings.proxyPort;
        const { command, args } = agentCommand({
          workspace: settings.workspace || undefined,
          port: settings.agentPort,
          proxyPort,
        });
        const proc = await host.process.spawn({ command, args, env: AGENT_ENV });

        let livePort = settings.agentPort;
        const offOutput = host.process.onOutput(proc.id, ({ text }) => {
          append(text);
          const found = extractToken(text);
          if (found) {
            tokenRef.current = found;
            setTokenState(found);
            void saveToken(host, found);
          }
          const port = extractPort(text);
          if (port) {
            livePort = port;
            // Without this the panel keeps talking to whatever sits on the old
            // port — usually the very agent we just tried to replace.
            if (port !== settings.agentPort) void saveSettings(host, { agentPort: port }).then(setSettings);
          }
        });

        try {
          const probe = new AgentClient(host, () => ({ agentPort: livePort, token: tokenRef.current }));
          const deadline = Date.now() + HEALTH_TIMEOUT_MS;
          let live: Health | null = null;
          while (Date.now() < deadline) {
            live = await probe.health().catch(() => null);
            if (live?.authenticated) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
          if (!live?.authenticated) throw new Error("the new agent did not answer — see the log");
          setSteps((s) => setStep(s, "agent", "done", `agent ${live.agent}`));
          await loadEverything();

          // Killing the agent takes its browser with it, so a restart that left
          // you with no window is a restart that undid your setup. Open one.
          const device = (await probe.get<{ devices: Device[] }>("/devices")).devices[0];
          if (device) {
            setSteps((s) => setStep(s, "browser", "running"));
            const opened = await probe.post<{ session: { sessionId: string } }>("/sessions", {
              deviceId: device.id,
              proxyPort,
              headless: false,
            });
            setDeviceId(device.id);
            setSessionId(opened.session.sessionId);
            setSteps((s) => setStep(s, "browser", "done", "browser open"));
            await loadEverything();
          }
        } finally {
          offOutput();
        }
      });

    /** Start the agent, wait for it to answer, and make sure a device exists. */
    const startSetup = () =>
      guard(async () => {
        if (!host.process) throw new Error("this Trawl version cannot start the agent");
        setLog([]);
        // Repeated Starts must not stack agents; ours are killed before a respawn.
        for (const proc of await host.process.list()) await host.process.kill(proc.id).catch(() => {});

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
        const proc = await host.process.spawn({ command, args, env: AGENT_ENV });

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

          // A browser, not a recording. Setting up is not the same as deciding
          // to record, and a recorder that starts itself catches whatever the
          // person happened to do while getting their bearings.
          setSteps((s) => setStep(s, "record", "running"));
          const opened = await probe.post<{ session: { sessionId: string } }>("/sessions", {
            deviceId: device.id,
            proxyPort,
            headless: false,
          });
          // The browser that just opened is the one to keep working in — list it
          // and select it, or the picker still says "new browser".
          setSessionId(opened.session.sessionId);
          await loadEverything();
          setSteps((s) => setStep(s, "record", "done", "browser open — press Record when you are ready"));
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
        setScriptName(path.replace(/^scripts\//, "").replace(/\.js$/, ""));
        if (path) {
          const loaded = (await agent.get<{ code: string }>("/scripts/read", { path })).code;
          setCode(loaded);
          setSavedCode(loaded);
        }
      });

    /** `login` and `scripts/login.js` both mean the same file. */
    const scriptPath = (name: string): string => {
      const trimmed = name.trim().replace(/^\/+/, "");
      if (!trimmed) return "";
      const withDir = trimmed.startsWith("scripts/") ? trimmed : `scripts/${trimmed}`;
      return withDir.endsWith(".js") ? withDir : `${withDir}.js`;
    };

    const runScript = () =>
      guard(async () => {
        const live = await host.capture?.start();
        const started = await runs.start({
          path: selectedScript || undefined,
          code,
          deviceId,
          sessionId: sessionId || undefined,
          proxyPort: live?.port ?? settings.proxyPort,
          stepDelayMs: device?.stepDelayMs,
          closeAfterRun: device?.closeAfterRun,
        });
        setReport(started);
        // Every poll lands on screen: a run you cannot watch is a run you
        // cannot pause at the right moment.
        const finished = await runs.waitFor(started.runId, undefined, undefined, setReport);
        setReport(finished);
        setRunPaused(false);
        if (finished.sessionId) {
          setSessionId(finished.sessionId);
          await loadEverything();
        }
      });

    /**
     * Every visual edit goes through here: the agent rewrites the source by
     * range and hands it back, so a row change is a text change and the code
     * tab, the diff and undo all keep working.
     */
    const runCommand = (command: Command) =>
      guard(async () => {
        const result = await rowsClient.apply(code, command);
        setCode(result.code);
        editorRef.current?.replaceAll(result.code);
        if (result.extracted) {
          setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
        }
      });

    /**
     * An assertion written from what actually happened. Nobody has to remember
     * the endpoint or the status — both are on the screen already, and the check
     * lands right after the step that caused the request.
     */
    const pinObservation = (request: { matcher: string; status: number; afterLine: number | null }) =>
      guard(async () => {
        const result = await rowsClient.apply(code, {
          kind: "insert",
          before: anchorAfterLine(rows, request.afterLine),
          action: "expectApi",
          args: [request.matcher, request.status],
        });
        setCode(result.code);
        editorRef.current?.replaceAll(result.code);
      });

    /**
     * The other way to add a step: point at it. A recording opens on the browser
     * already on screen, and whatever is clicked lands at this row.
     */
    const pointAtStep = (before: string | null) =>
      guard(async () => {
        const live = await host.capture?.start();
        const started = await agent.post<{ id: string; sessionId: string }>("/record/start", {
          ...(sessionId ? { sessionId } : { deviceId }),
          proxyPort: live?.port ?? settings.proxyPort,
        });
        setRecordingId(started.id);
        setRecordingPaused(false);
        setSessionId(started.sessionId);
        setPointingAt({ before });
      });

    /** Give up on the run. It stops at the next step, held or not. */
    const stopRun = () =>
      guard(async () => {
        if (!report || report.status !== "running") return;
        // A held run notices this too: the pause loop watches for it.
        await runs.cancel(report.runId);
        setRunPaused(false);
      });

    /** Hold the run between steps; the browser stays exactly where it is. */
    const toggleRunPause = () =>
      guard(async () => {
        if (!report || report.status !== "running") return;
        const next = !runPaused;
        await runs.setPaused(report.runId, next);
        setRunPaused(next);
      });

    /**
     * Record the missing bit right where the run stopped — on a failure, or on
     * a pause. The browser is sitting on that very step, so whatever extra
     * click or confirmation is needed can be performed and spliced into the
     * script at that line.
     */
    const recordContinuation = () =>
      guard(async () => {
        // On a failure that is the step that died; while paused it is the step
        // about to run, which is the one the missing action belongs before.
        const at =
          report?.steps.find((s) => s.status === "failed") ??
          (report?.status === "running" ? report.steps[report.steps.length - 1] : undefined);
        if (!report?.sessionId || !at) return;
        const live = await host.capture?.start();
        const started = await agent.post<{ id: string }>("/record/start", {
          sessionId: report.sessionId,
          proxyPort: live?.port ?? settings.proxyPort,
        });
        setRecordingId(started.id);
        setRecordingPaused(false);
        setContinuationLine(at.line ?? null);
        setSessionId(report.sessionId);
      });

    const startRecording = () =>
      guard(async () => {
        const live = await host.capture?.start();
        const proxyPort = live?.port ?? settings.proxyPort;
        const begin = (where: Record<string, string>) =>
          agent.post<{ id: string; sessionId: string }>("/record/start", { ...where, proxyPort });

        // Continuing in an open browser keeps everything already done there —
        // log in once, then record just the part you care about. But a window
        // the human closed in the meantime should cost a new browser, not an
        // error about a session nobody can see.
        const started = sessionId
          ? await begin({ sessionId }).catch((err: Error) => {
              if (!/unknown session/i.test(err.message)) throw err;
              setSessionId("");
              return begin({ deviceId });
            })
          : await begin({ deviceId });

        setRecordingId(started.id);
        setRecordingPaused(false);
        setSessionId(started.sessionId);
        await loadEverything();
      });

    /**
     * Stop taking clicks without ending the recording: a detour, a captcha or
     * fixing a typo is not part of the scenario, and having to stop the whole
     * recording to do it is what makes people re-record from the start.
     */
    const togglePause = () =>
      guard(async () => {
        if (!recordingId) return;
        const next = !recordingPaused;
        const state = await agent.post<{ paused: boolean }>(`/record/${recordingId}/pause`, { paused: next });
        setRecordingPaused(state.paused);
      });

    const stopRecording = () =>
      guard(async () => {
        if (!recordingId) return;
        // An agent restarted under us has no memory of this recording. Staying
        // in "recording" for ever, refusing to stop, helps nobody.
        const stillThere = await agent.get(`/record/${recordingId}`).then(
          () => true,
          () => false,
        );
        if (!stillThere) {
          setRecordingId(null);
          setRecordingPaused(false);
          setContinuationLine(null);
          setPointingAt(null);
          throw new Error("this recording is gone — the agent was restarted. Press Record to start a new one.");
        }

        if (pointingAt) {
          const pointed = await agent.post<{ steps: { action: string; args: unknown[] }[] }>(
            `/record/${recordingId}/stop`,
            {},
          );
          setRecordingId(null);
          setRecordingPaused(false);
          // Each recorded step lands before the same anchor, so they end up in
          // the order they were performed, directly above it.
          let next = code;
          for (const step of pointed.steps.filter((s) => s.action !== "goto")) {
            next = (
              await rowsClient.apply(next, {
                kind: "insert",
                before: pointingAt.before,
                action: step.action,
                args: step.args,
              })
            ).code;
          }
          setCode(next);
          editorRef.current?.replaceAll(next);
          setPointingAt(null);
          return;
        }

        if (continuationLine !== null) {
          const result = await agent.post<{ code: string; warnings: string[] }>(
            `/record/${recordingId}/stop`,
            {},
          );
          setRecordingId(null);
          setRecordingPaused(false);
          // Everything the recorder produced, minus its header comment, goes in
          // above the step that failed — that is where it was missing.
          const lines = result.code
            .split("\n")
            .filter((line) => line.trim() && !line.startsWith("//"))
            .join("\n");
          if (lines) {
            editorRef.current?.insertLines?.(continuationLine, lines);
            setCode(editorRef.current?.getValue() ?? code);
          }
          setContinuationLine(null);
          if (result.warnings.length) setError(result.warnings.join("; "));
          return;
        }
        const name = scriptPath(scriptName) || selectedScript || `scripts/recorded-${scripts.length + 1}.js`;
        const result = await agent.post<{ code: string; scriptPath?: string; warnings: string[] }>(
          `/record/${recordingId}/stop`,
          { saveAs: name },
        );
        setRecordingId(null);
        setRecordingPaused(false);
        setCode(result.code);
        setSelectedScript(result.scriptPath ?? "");
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
        await loadEverything();
        if (result.warnings.length) setError(result.warnings.join("; "));
      });

    /**
     * Delete the selected scenario. The agent refuses while another scenario
     * calls it, because that one would then die on a missing file at run time,
     * in a suite, at the worst moment — so the refusal is offered as a choice
     * rather than swallowed.
     */
    const deleteScript = () =>
      guard(async () => {
        if (!selectedScript) return;
        const remove = (force: boolean) =>
          agent.post<{ deleted: string }>("/scripts/delete", { path: selectedScript, force });

        try {
          await remove(false);
        } catch (err) {
          const message = (err as Error).message;
          if (!/вызывают/.test(message)) throw err;
          // Asked here rather than through a modal: the answer needs the list of
          // callers in front of it, and the host has no confirm dialog anyway.
          setDeleteBlocked({ path: selectedScript, message });
          return;
        }

        setDeleteBlocked(null);
        setSelectedScript("");
        setCode("");
        setSavedCode("");
        editorRef.current?.replaceAll("");
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
      });

    const saveScript = () =>
      guard(async () => {
        const path = scriptPath(scriptName) || selectedScript || `scripts/script-${scripts.length + 1}.js`;
        await agent.post("/scripts/write", { path, code });
        setSavedCode(code);
        setSelectedScript(path);
        setScriptName(path.replace(/^scripts\//, "").replace(/\.js$/, ""));
        setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
      });

    /** Run a whole suite, polling until it settles. */
    const runSuite = () =>
      guard(async () => {
        if (!selectedSuite) return;
        const file = await agent.get<{ scripts: string[] }>("/suites/read", { path: selectedSuite });
        const started = await runs.startSuite({
          path: selectedSuite,
          scripts: file.scripts,
          deviceId,
          stepDelayMs: device?.stepDelayMs,
        });
        setPane("suite");
        for (;;) {
          const current = (await runs.pollSuite(started.suiteId)) as unknown as SuiteReport;
          setSuiteReport(current);
          if (current.status !== "running") break;
          await new Promise((r) => setTimeout(r, 800));
        }
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

    const device = devices.find((d) => d.id === deviceId);
    const envVars = host.projects.active()?.env ?? [];
    /** Vocabulary this plugin uses that the running agent has never heard of. */
    const missingSteps = health?.steps
      ? ["mock", "run", "saveState", "useState"].filter((step) => !health.steps!.includes(step))
      : [];

    /** Both knobs live on the device, so they survive restarts. */
    const patchDevice = (patch: Partial<Device>) =>
      guard(async () => {
        if (!device) return;
        const next = { ...device, ...patch };
        setDevices((all) => all.map((d) => (d.id === next.id ? next : d)));
        await agent.post("/devices", next);
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
          port={settings.agentPort}
          onRecheck={() => void loadEverything().catch(() => {})}
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

          <Select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            title="Where Run and Record happen"
          >
            <option value="">new browser</option>
            {openSessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                open: {(s.currentUrl ?? "blank").replace(/^https?:\/\//, "").slice(0, 28)}
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
          {selectedScript && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className="border border-border"
              title={`Удалить ${selectedScript}`}
              onClick={() => void deleteScript()}
            >
              Delete
            </Button>
          )}
          <Input
            value={scriptName}
            placeholder="name, e.g. login"
            title="Saved as scripts/<name>.js"
            onChange={(e) => setScriptName(e.target.value)}
            style={{ width: 150 }}
          />

          {recordingId ? (
            <>
              <Button
                disabled={busy}
                variant={recordingPaused ? "default" : "ghost"}
                title={
                  recordingPaused
                    ? "Take clicks again, carrying on where the recording left off"
                    : "Stop taking clicks for a moment — a detour or a captcha is not part of the scenario"
                }
                onClick={() => void togglePause()}
              >
                {recordingPaused ? "▶ Resume" : "⏸ Pause"}
              </Button>
              <Button disabled={busy} onClick={() => void stopRecording()}>
                {continuationLine !== null ? `Stop and insert at line ${continuationLine}` : "⏹ Stop"}
              </Button>
            </>
          ) : report?.status === "running" ? (
            <>
              <Button
                disabled={busy}
                variant={runPaused ? "default" : "ghost"}
                title={
                  runPaused
                    ? "Carry on from the step it was holding at"
                    : "Hold between steps — the browser stays exactly where it is"
                }
                onClick={() => void toggleRunPause()}
              >
                {runPaused ? "▶ Resume run" : "⏸ Pause run"}
              </Button>
              {runPaused && report.sessionId && (
                <Button
                  disabled={busy}
                  title="Do the missing bit by hand — it is spliced into the script at this step"
                  onClick={() => void recordContinuation()}
                >
                  Record here
                </Button>
              )}
              <Button
                disabled={busy}
                variant="ghost"
                title="Give up on this run — it stops at the next step"
                onClick={() => void stopRun()}
              >
                ⏹ Stop run
              </Button>
            </>
          ) : report?.sessionId && report.steps.some((s) => s.status === "failed") ? (
            <Button
              disabled={busy}
              title="The browser is still on the failure — record what it needed and drop it into the script"
              onClick={() => void recordContinuation()}
            >
              Record the missing steps
            </Button>
          ) : (
            <Button disabled={busy || !deviceId} onClick={() => void startRecording()}>
              Record
            </Button>
          )}
          <Button disabled={busy || !code} onClick={() => void saveScript()}>
            Save
          </Button>
          {selectedScript && (
            <span
              className="text-xs text-muted-foreground"
              title="run() reads scripts from disk, so a scenario you compose into must be saved"
            >
              {savedCode === code ? "saved" : "unsaved"}
            </span>
          )}
          <Button disabled={busy || !deviceId || !code} onClick={() => void runScript()}>
            Run
          </Button>

          {suites.length > 0 && (
            <>
              <Select value={selectedSuite} onChange={(e) => setSelectedSuite(e.target.value)}>
                <option value="">— suite —</option>
                {suites.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/^suites\//, "").replace(/\.json$/, "")}
                  </option>
                ))}
              </Select>
              <Button disabled={busy || !deviceId || !selectedSuite} onClick={() => void runSuite()}>
                Run suite
              </Button>
            </>
          )}

          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Pause after each step">
            pause
            <Input
              value={String(device?.stepDelayMs ?? 0)}
              onChange={(e) => void patchDevice({ stepDelayMs: Number(e.target.value) || 0 })}
              style={{ width: 64 }}
            />
            ms
          </label>
          <label
            className="flex items-center gap-1 text-xs text-muted-foreground"
            title="Record the run as frames, with the pointer drawn in — playable from the history tab"
          >
            <input
              type="checkbox"
              checked={device?.video ?? false}
              onChange={(e) => void patchDevice({ video: e.target.checked })}
            />
            record
          </label>
          {device?.video && (
            <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Frames per second">
              <Input
                value={String(device?.videoFps ?? 5)}
                onChange={(e) => void patchDevice({ videoFps: Math.min(30, Math.max(1, Number(e.target.value) || 5)) })}
                style={{ width: 48 }}
              />
              fps
            </label>
          )}
          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Close the browser when a run ends">
            <input
              type="checkbox"
              checked={device?.closeAfterRun ?? true}
              onChange={(e) => void patchDevice({ closeAfterRun: e.target.checked })}
            />
            close browser
          </label>

          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span title={health?.workspace ?? ""}>agent {health?.agent}</span>
            {missingSteps.length > 0 && (
              <span
                className="rounded bg-amber-500/20 px-1 text-amber-500"
                title={`This agent has no ${missingSteps.join(", ")} — restart it to pick up the current version`}
              >
                outdated
              </span>
            )}
            {!captureOn && <span>capture off: steps will have no traffic</span>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void restartAgent()}>
              Restart agent
            </Button>
          </span>
        </div>

        {recordingId && (
          <div
            className={`px-2 py-1.5 text-xs border-b border-border flex items-center gap-2 ${
              recordingPaused ? "bg-amber-500/10" : "bg-primary/10"
            }`}
          >
            <span className={recordingPaused ? "text-amber-500" : "text-primary"}>
              {recordingPaused ? "⏸" : "●"}
            </span>
            {recordingPaused
              ? "Paused — clicks are being ignored. Do whatever you need, then press Resume; Stop finishes the recording."
              : "Recording — do things in the browser window. Pause ignores clicks without ending it; Stop finishes and writes the script."}
          </div>
        )}

        {draft && (
          <div className="px-2 py-1.5 text-xs border-b border-border bg-primary/10 flex items-center gap-2">
            <span className="text-primary">✎</span>
            <span>
              Черновик от агента{draft.note ? `: ${draft.note}` : ""}. Ничего не сохранено — посмотрите и
              нажмите Save, если годится.
            </span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setDraft(null)}>
              Понятно
            </Button>
          </div>
        )}

        {deleteBlocked && (
          <div className="px-2 py-1.5 text-xs border-b border-border bg-amber-500/10 flex items-center gap-2">
            <span className="text-amber-500">⚠</span>
            <span>{deleteBlocked.message}</span>
            <span className="ml-auto flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void guard(async () => {
                    await agent.post("/scripts/delete", { path: deleteBlocked.path, force: true });
                    setDeleteBlocked(null);
                    setSelectedScript("");
                    setCode("");
                    setSavedCode("");
                    editorRef.current?.replaceAll("");
                    setScripts((await agent.get<{ scripts: string[] }>("/scripts")).scripts);
                  })
                }
              >
                Всё равно удалить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleteBlocked(null)}>
                Отмена
              </Button>
            </span>
          </div>
        )}

        {report?.status === "running" && (
          <div
            className={`px-2 py-1.5 text-xs border-b border-border flex items-center gap-2 ${
              runPaused ? "bg-amber-500/10" : "bg-primary/10"
            }`}
          >
            <span className={runPaused ? "text-amber-500" : "text-primary"}>{runPaused ? "⏸" : "▶"}</span>
            {runPaused
              ? `Held at step ${report.steps.length} — the browser is sitting there. “Record here” splices what you do by hand into the script.`
              : `Running — step ${report.steps.length}. Pause holds it between steps without losing the browser.`}
          </div>
        )}

        {error && <div className="px-2 py-1 text-xs text-destructive border-b border-border">{error}</div>}

        <div
          className="flex flex-1 min-h-0"
          onMouseMove={(e) => {
            if (!dragging.current) return;
            const box = e.currentTarget.getBoundingClientRect();
            const pct = ((box.right - e.clientX) / box.width) * 100;
            setReportWidth(Math.min(80, Math.max(20, pct)));
          }}
          onMouseUp={() => (dragging.current = false)}
          onMouseLeave={() => (dragging.current = false)}
        >
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex gap-1 border-b border-border px-2 py-1 text-xs">
              {(["rows", "canvas", "code"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  title={
                    m === "rows"
                      ? "Edit the scenario as steps — no typing"
                      : "The same scenario as the file it is"
                  }
                  className={`rounded px-2 py-0.5 ${mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m}
                </button>
              ))}
              {mode === "rows" && rows.some((r) => r.kind === "code") && (
                <span className="ml-auto text-muted-foreground" title="Shown read-only and kept exactly as written">
                  {rows.filter((r) => r.kind === "code").length} line(s) only the code tab can edit
                </span>
              )}
            </div>
            <div className="flex-1 min-h-0">
              {/* The editor stays mounted: it owns undo history and the
                  highlight of a failed line, and both survive a mode switch. */}
              <div className={mode === "code" ? "h-full" : "hidden"}>
                <ScriptEditor value={code} onChange={setCode} language="javascript" apiRef={editorRef} />
              </div>
              {mode !== "code" && rowsError !== null && (
                <RowsError host={host} message={rowsError} onRestartAgent={() => void restartAgent()} />
              )}
              {mode === "rows" && rowsError === null && (
                <RowsView
                  host={host}
                  rows={rows}
                  screens={screens}
                  onCommand={runCommand}
                  onPoint={pointAtStep}
                  selected={selectedRow}
                  onSelect={setSelectedRow}
                />
              )}
              {mode === "canvas" && rowsError === null && (
                <CanvasView
                  host={host}
                  rows={rows}
                  screens={screens}
                  scripts={scripts}
                  onCommand={runCommand}
                  onPoint={pointAtStep}
                  selected={selectedRow}
                  onSelect={setSelectedRow}
                />
              )}
            </div>
            <div className="border-t border-border px-2 py-1.5 text-xs flex flex-wrap gap-x-3 gap-y-1 items-center">
              <span className="text-muted-foreground">variables:</span>
              {envVars.length === 0 ? (
                <span className="text-muted-foreground">
                  none — add them to the active project to use {"{{NAME}}"} here
                </span>
              ) : (
                envVars.map((v) => (
                  <button
                    key={v.key}
                    title={`${v.value} — click to insert {{${v.key}}}`}
                    className="font-mono rounded bg-muted/50 px-1.5 py-0.5 hover:bg-muted"
                    onClick={() => editorRef.current?.insert(`{{${v.key}}}`)}
                  >
                    {`{{${v.key}}}`}
                  </button>
                ))
              )}
              {scripts.length > 0 && (
                <>
                  <span className="text-muted-foreground ml-2">compose:</span>
                  {scripts
                    .filter((path) => path !== selectedScript)
                    .slice(0, 6)
                    .map((path) => (
                      <button
                        key={path}
                        title={`Append run('${path}')`}
                        className="font-mono rounded bg-muted/50 px-1.5 py-0.5 hover:bg-muted"
                        onClick={() => editorRef.current?.insert(`run('${path}')\n`)}
                      >
                        run({path.replace(/^scripts\//, "").replace(/\.js$/, "")})
                      </button>
                    ))}
                </>
              )}
            </div>
          </div>
          <div
            onMouseDown={() => (dragging.current = true)}
            onDoubleClick={() => setReportWidth(45)}
            title="Drag to resize · double-click to reset"
            className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/60"
          />
          <div style={{ width: `${reportWidth}%` }} className="min-w-0 flex flex-col">
            <div className="flex gap-1 border-b border-border px-2 py-1 text-xs">
              {(["report", "map", "coverage", "suite", "history", "guide"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setPane(tab)}
                  className={`rounded px-2 py-0.5 ${pane === tab ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0">
              {pane === "report" && (
                <RunReportView
                  host={host}
                  report={report}
                  onPin={pinObservation}
                  context={{
                    workspace: health?.workspace ?? settings.workspace,
                    agentVersion: health?.agent ?? null,
                    env: Object.fromEntries(envVars.map((v) => [v.key, v.value])),
                  }}
                />
              )}
              {pane === "suite" && (
                <SuiteView
                  host={host}
                  report={suiteReport}
                  onOpenRun={(runId) =>
                    void guard(async () => {
                      setReport(await runs.poll(runId));
                      setPane("report");
                    })
                  }
                />
              )}
              {pane === "history" && (
                <HistoryView
                  host={host}
                  agent={agent}
                  script={selectedScript}
                  onOpen={(past) => {
                    setReport(past);
                    setPane("report");
                  }}
                />
              )}
              {pane === "map" && (
                <MapView
                  host={host}
                  agent={agent}
                  onInsert={(reference) => {
                    // At the caret: the reference is wanted where the step is
                    // being written, not at the top of the file.
                    editorRef.current?.insert(`click('${reference.replace(/'/g, "\\'")}')`);
                    setCode(editorRef.current?.getValue() ?? code);
                  }}
                />
              )}
              {pane === "coverage" && <CoverageView host={host} agent={agent} />}
              {pane === "guide" && <GuideView host={host} agent={agent} />}
            </div>
          </div>
        </div>
      </div>
    );
  };
}
