"use client";

import { useEffect, useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getDebugInfo,
  getLogFilePath,
  getProjectileLogInfo,
  openLogsFolder,
  openProjectileLogFile,
  openProjectileLogsFolder,
  readProjectileDebugLogs,
  readLogTail,
  writeDebugLog,
} from "@/lib/api";

const PROJECTILE_DEBUG_KEY = "roundlab.debugProjectiles";

export function DebugConsole({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown>>({});
  const [logPath, setLogPath] = useState<string>("");
  const [actionStatus, setActionStatus] = useState<string>("");
  const [projectileDebug, setProjectileDebug] = useState(false);
  const [projectileLogLines, setProjectileLogLines] = useState<number | null>(null);
  const [projectileScannedLines, setProjectileScannedLines] = useState<number | null>(null);
  const [projectileLogPaths, setProjectileLogPaths] = useState<string[]>([]);
  const [projectileWrittenPath, setProjectileWrittenPath] = useState<string>("");
  const [projectileRawTail, setProjectileRawTail] = useState<string>("");
  const [projectileFilePath, setProjectileFilePath] = useState<string>("");
  const [projectileFileSize, setProjectileFileSize] = useState<number | null>(null);
  const [projectileFileLines, setProjectileFileLines] = useState<number | null>(null);
  const [logViewer, setLogViewer] = useState<{
    title: string;
    text: string;
    clipboardStatus: "copied" | "failed" | "not-attempted";
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const enabled = window.localStorage.getItem(PROJECTILE_DEBUG_KEY) === "1";
    setProjectileDebug(enabled);

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const captureLog = (prefix: string, ...args: unknown[]) => {
      const message = args.map((arg) =>
        typeof arg === "string" ? arg : JSON.stringify(arg, null, 2),
      ).join(" ");
      setLogs((prev) => {
        const updated = [...prev, `[${prefix}] ${message}`];
        return updated.slice(-100);
      });
      if (prefix === "LOG") originalLog(...args);
      else if (prefix === "ERROR") originalError(...args);
      else if (prefix === "WARN") originalWarn(...args);
    };

    console.log = (...args) => captureLog("LOG", ...args);
    console.error = (...args) => captureLog("ERROR", ...args);
    console.warn = (...args) => captureLog("WARN", ...args);

    const pollDebugInfo = async () => {
      try {
        const info = await getDebugInfo();
        setDebugInfo(info);
      } catch {
        /* ignore errors during polling */
      }
    };

    // One-shot fetch of the log file path; never changes within a session.
    getLogFilePath().then(setLogPath).catch(() => setLogPath(""));

    const refreshProjectileCount = async () => {
      try {
        const scan = await readProjectileDebugLogs(10_000);
        setProjectileLogLines(scan.matchedLines);
        setProjectileScannedLines(scan.scannedLines);
        setProjectileLogPaths(scan.paths);
        setProjectileWrittenPath(scan.writtenPath);
        setProjectileRawTail(scan.rawTail);
        setProjectileFilePath(scan.projectilePath);
        setProjectileFileSize(scan.projectileSizeBytes);
        setProjectileFileLines(scan.projectileLines);
      } catch {
        setProjectileLogLines(null);
        setProjectileScannedLines(null);
      }
    };

    void refreshProjectileCount();
    const timer = setInterval(pollDebugInfo, 500);
    const projectileTimer = setInterval(refreshProjectileCount, 2500);

    return () => {
      clearInterval(timer);
      clearInterval(projectileTimer);
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, [isOpen]);

  const flashStatus = (msg: string) => {
    setActionStatus(msg);
    window.setTimeout(() => setActionStatus(""), 4000);
  };

  const textStats = (text: string) => {
    const lines = text ? text.split("\n").length : 0;
    return { chars: text.length, lines };
  };

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "unknown";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const refreshProjectileFileInfo = async () => {
    const info = await getProjectileLogInfo();
    setProjectileFilePath(info.path);
    setProjectileFileSize(info.sizeBytes);
    setProjectileFileLines(info.lines);
    return info;
  };

  const copyTextOrShow = async (title: string, text: string) => {
    const stats = textStats(text);
    try {
      await navigator.clipboard.writeText(text);
      setLogViewer({ title, text, clipboardStatus: "copied" });
      flashStatus(`Clipboard OK: ${stats.lines} lines, ${stats.chars} chars.`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      setLogViewer({ title, text, clipboardStatus: "failed", error: message });
      flashStatus(`Clipboard failed; showing logs here. ${stats.lines} lines, ${stats.chars} chars.`);
      return false;
    }
  };

  const handleCopyLogPath = async () => {
    if (!logPath) return;
    await copyTextOrShow("Log path", logPath);
  };

  const handleOpenLogsFolder = async () => {
    try {
      await openLogsFolder();
      flashStatus("Logs folder opened.");
    } catch (err) {
      flashStatus(`Open failed: ${err}`);
    }
  };

  const handleCopyAppTail = async () => {
    try {
      const tail = await readLogTail(500);
      if (!tail) {
        flashStatus("No logs yet.");
        return;
      }
      await copyTextOrShow("Last 500 app logs", tail);
    } catch (err) {
      flashStatus(`Copy tail failed: ${err}`);
    }
  };

  const handleToggleProjectileDebug = async () => {
    const next = !projectileDebug;
    window.localStorage.setItem(PROJECTILE_DEBUG_KEY, next ? "1" : "0");
    setProjectileDebug(next);
    try {
      const writtenPath = await writeDebugLog(
        "projectiles",
        `ROUNDLAB_DEBUG_PROJECTILES ${next ? "enabled" : "disabled"} from DebugConsole`,
      );
      const scan = await readProjectileDebugLogs(10_000);
      setProjectileLogLines(scan.matchedLines);
      setProjectileScannedLines(scan.scannedLines);
      setProjectileLogPaths(scan.paths);
      setProjectileWrittenPath(writtenPath || scan.writtenPath);
      setProjectileRawTail(scan.rawTail);
      setProjectileFilePath(scan.projectilePath);
      setProjectileFileSize(scan.projectileSizeBytes);
      setProjectileFileLines(scan.projectileLines);
    } catch {
      /* ignore logging failures */
    }
    flashStatus(`Projectile debug ${next ? "enabled" : "disabled"}.`);
  };

  const handleWriteProjectileTest = async () => {
    try {
      const writtenPath = await writeDebugLog(
        "projectiles",
        `ROUNDLAB_DEBUG_PROJECTILES frontend-test localStorage=${window.localStorage.getItem(PROJECTILE_DEBUG_KEY) ?? "null"}`,
      );
      const scan = await readProjectileDebugLogs(10_000);
      setProjectileLogLines(scan.matchedLines);
      setProjectileScannedLines(scan.scannedLines);
      setProjectileLogPaths(scan.paths);
      setProjectileWrittenPath(writtenPath || scan.writtenPath);
      setProjectileRawTail(scan.rawTail);
      setProjectileFilePath(scan.projectilePath);
      setProjectileFileSize(scan.projectileSizeBytes);
      setProjectileFileLines(scan.projectileLines);
      if (!scan.lines.includes("ROUNDLAB_DEBUG_PROJECTILES frontend-test")) {
        flashStatus(`ERROR: frontend-test not found. Wrote ${writtenPath}; scanned ${scan.scannedLines}, matches ${scan.matchedLines}.`);
        return;
      }
      flashStatus(`frontend-test found. Wrote ${writtenPath}; matches ${scan.matchedLines}.`);
    } catch (err) {
      flashStatus(`Write frontend-test failed: ${err}`);
    }
  };

  const handleCopyProjectileTail = async () => {
    try {
      const scan = await readProjectileDebugLogs(10_000);
      setProjectileLogLines(scan.matchedLines);
      setProjectileScannedLines(scan.scannedLines);
      setProjectileLogPaths(scan.paths);
      setProjectileWrittenPath(scan.writtenPath);
      setProjectileRawTail(scan.rawTail);
      setProjectileFilePath(scan.projectilePath);
      setProjectileFileSize(scan.projectileSizeBytes);
      setProjectileFileLines(scan.projectileLines);
      if (!scan.lines) {
        flashStatus(`No projectile debug lines in file. Scanned ${scan.scannedLines} lines.`);
        setLogViewer({
          title: "Projectile log scan raw tail",
          text: scan.rawTail || "(No raw log lines found.)",
          clipboardStatus: "not-attempted",
        });
        return;
      }
      await copyTextOrShow("Projectile logs from file", scan.lines);
    } catch (err) {
      flashStatus(`Copy projectile logs failed: ${err}`);
    }
  };

  const handleShowProjectileLogs = async () => {
    try {
      const scan = await readProjectileDebugLogs(10_000);
      setProjectileLogLines(scan.matchedLines);
      setProjectileScannedLines(scan.scannedLines);
      setProjectileLogPaths(scan.paths);
      setProjectileWrittenPath(scan.writtenPath);
      setProjectileRawTail(scan.rawTail);
      setProjectileFilePath(scan.projectilePath);
      setProjectileFileSize(scan.projectileSizeBytes);
      setProjectileFileLines(scan.projectileLines);
      setLogViewer({
        title: "Projectile logs from file",
        text: scan.lines || scan.rawTail || "(No projectile debug lines found.)",
        clipboardStatus: "not-attempted",
      });
      const stats = textStats(scan.lines || scan.rawTail || "");
      flashStatus(`Showing projectile logs: ${stats.lines} lines, ${stats.chars} chars, ${scan.matchedLines} matches.`);
    } catch (err) {
      flashStatus(`Show projectile logs failed: ${err}`);
    }
  };

  const handleOpenProjectileLogFile = async () => {
    try {
      const info = await refreshProjectileFileInfo();
      await openProjectileLogFile();
      flashStatus(`Projectile log file opened: ${info.lines} lines, ${formatBytes(info.sizeBytes)}.`);
    } catch (err) {
      flashStatus(`Open projectile log file failed: ${err}`);
    }
  };

  const handleOpenProjectileLogsFolder = async () => {
    try {
      const info = await refreshProjectileFileInfo();
      await openProjectileLogsFolder();
      flashStatus(`Projectile logs folder opened: ${info.path}`);
    } catch (err) {
      flashStatus(`Open projectile logs folder failed: ${err}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] border-t border-white/10 bg-[#0f1010]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 hover:text-neutral-200"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronUp className="size-3" />
          )}
          Debug Console
        </button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          className="text-neutral-500 hover:text-neutral-300"
        >
          <X className="size-4" />
        </Button>
      </div>

      {expanded && (
        <div className="max-h-96 overflow-y-auto bg-black/30 font-mono text-[10px] text-neutral-400">
          <div className="border-b border-white/10 bg-black/40 px-3 py-2">
            <div className="text-[11px] font-semibold text-neutral-300">Parser State</div>
            <div className="mt-1 space-y-1 text-[9px]">
              <div>
                Running:{" "}
                <span className={debugInfo.running ? "text-emerald-300" : "text-neutral-500"}>
                  {String(debugInfo.running ?? false)}
                </span>
              </div>
              <div>
                Timeout Triggered:{" "}
                <span className={debugInfo.timeoutTriggered ? "text-red-300" : "text-neutral-500"}>
                  {String(debugInfo.timeoutTriggered ?? false)}
                </span>
              </div>
              <div>
                Cancel Requested:{" "}
                <span className={debugInfo.cancelRequested ? "text-yellow-300" : "text-neutral-500"}>
                  {String(debugInfo.cancelRequested ?? false)}
                </span>
              </div>
            </div>
          </div>

          <div className="border-b border-white/10 bg-black/40 px-3 py-2">
            <div className="text-[11px] font-semibold text-neutral-300">Persistent log file</div>
            <div className="mt-1 break-all font-mono text-[9px] text-neutral-500">
              {logPath || "<resolving…>"}
            </div>
            <div className="mt-2 grid gap-1 text-[9px] text-neutral-400">
              <div>
                Projectile debug:{" "}
                <span className={projectileDebug ? "text-emerald-300" : "text-neutral-500"}>
                  {projectileDebug ? "enabled" : "disabled"}
                </span>
              </div>
              <div>
                Projectile log lines in file:{" "}
                <span className={projectileLogLines && projectileLogLines > 0 ? "text-emerald-300" : "text-neutral-500"}>
                  {projectileLogLines ?? "unknown"}
                </span>
              </div>
              <div>
                Projectile scan lines:{" "}
                <span className={projectileScannedLines && projectileScannedLines > 0 ? "text-neutral-300" : "text-neutral-500"}>
                  {projectileScannedLines ?? "unknown"}
                </span>
              </div>
              <div className="break-all">
                Projectile scan paths:{" "}
                <span className="text-neutral-500">
                  {projectileLogPaths.length ? projectileLogPaths.join(" | ") : "unknown"}
                </span>
              </div>
              <div className="break-all">
                Projectile written path:{" "}
                <span className="text-neutral-500">
                  {projectileWrittenPath || "unknown"}
                </span>
              </div>
              <div className="break-all">
                Projectile dedicated file:{" "}
                <span className="text-neutral-500">
                  {projectileFilePath || "unknown"}
                </span>
              </div>
              <div>
                Projectile file size:{" "}
                <span className={projectileFileSize && projectileFileSize > 0 ? "text-emerald-300" : "text-neutral-500"}>
                  {formatBytes(projectileFileSize)}
                </span>
                {" · lines: "}
                <span className={projectileFileLines && projectileFileLines > 0 ? "text-emerald-300" : "text-neutral-500"}>
                  {projectileFileLines ?? "unknown"}
                </span>
              </div>
              {projectileLogLines === 0 && projectileRawTail && (
                <div className="whitespace-pre-wrap break-all border border-red-400/20 bg-red-950/20 p-2 text-[8px] text-red-200">
                  Last raw log lines:
                  {"\n"}
                  {projectileRawTail}
                </div>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleOpenLogsFolder}
                className="h-6 px-2 text-[10px]"
              >
                Open logs folder
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleOpenProjectileLogFile}
                className="h-6 px-2 text-[10px]"
              >
                Open projectile log file
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleOpenProjectileLogsFolder}
                className="h-6 px-2 text-[10px]"
              >
                Open projectile logs folder
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyLogPath}
                className="h-6 px-2 text-[10px]"
                disabled={!logPath}
              >
                Copy log path
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyAppTail}
                className="h-6 px-2 text-[10px]"
              >
                Copy last 500 app logs
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleToggleProjectileDebug}
                className="h-6 px-2 text-[10px]"
              >
                {projectileDebug ? "Disable projectile debug" : "Enable projectile debug"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleWriteProjectileTest}
                className="h-6 px-2 text-[10px]"
              >
                Write test projectile log
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopyProjectileTail}
                className="h-6 px-2 text-[10px]"
              >
                Copy projectile logs from file
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleShowProjectileLogs}
                className="h-6 px-2 text-[10px]"
              >
                Show projectile logs
              </Button>
            </div>
            {actionStatus && (
              <div className="mt-1 text-[9px] text-emerald-300">{actionStatus}</div>
            )}
          </div>

          {logViewer && (
            <div className="border-b border-white/10 bg-black/50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold text-neutral-300">{logViewer.title}</div>
                  <div className="mt-1 text-[9px] text-neutral-500">
                    {textStats(logViewer.text).lines} lines · {textStats(logViewer.text).chars} chars · clipboard{" "}
                    {logViewer.clipboardStatus}
                    {logViewer.error ? ` (${logViewer.error})` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLogViewer(null)}
                  className="h-6 px-2 text-[10px]"
                >
                  Hide
                </Button>
              </div>
              <textarea
                readOnly
                value={logViewer.text}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-2 h-48 w-full resize-y rounded border border-white/10 bg-black/60 p-2 font-mono text-[9px] text-neutral-200 outline-none"
              />
            </div>
          )}

          <div className="border-b border-white/10 px-3 py-2">
            <div className="text-[11px] font-semibold text-neutral-300">Logs</div>
          </div>

          {logs.length === 0 ? (
            <div className="p-2 text-neutral-600">No logs yet…</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="border-b border-white/5 px-3 py-1 hover:bg-white/[0.02]">
                {log}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
