"use client";

import { useEffect, useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDebugInfo, writeDebugLog } from "@/lib/api";

const PROJECTILE_DEBUG_KEY = "roundlab.debugProjectiles";

export function DebugConsole({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown>>({ runtime: "browser", storage: "indexeddb" });
  const [actionStatus, setActionStatus] = useState<string>("");
  const [projectileDebug, setProjectileDebug] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(PROJECTILE_DEBUG_KEY) === "1",
  );
  const [logViewer, setLogViewer] = useState<{
    title: string;
    text: string;
    clipboardStatus: "copied" | "failed" | "not-attempted";
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const originalLog = console.log;
    const originalDebug = console.debug;
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
    console.debug = (...args) => captureLog("DEBUG", ...args);
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

    void pollDebugInfo();
    const timer = setInterval(pollDebugInfo, 500);

    return () => {
      clearInterval(timer);
      console.log = originalLog;
      console.debug = originalDebug;
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

  const handleToggleProjectileDebug = async () => {
    const next = !projectileDebug;
    window.localStorage.setItem(PROJECTILE_DEBUG_KEY, next ? "1" : "0");
    setProjectileDebug(next);
    try {
      await writeDebugLog(
        "projectiles",
        `ROUNDLAB_DEBUG_PROJECTILES ${next ? "enabled" : "disabled"} from DebugConsole`,
      );
    } catch {
      /* ignore logging failures */
    }
    flashStatus(`Projectile debug ${next ? "enabled" : "disabled"}.`);
  };

  const handleWriteProjectileTest = async () => {
    try {
      await writeDebugLog(
        "projectiles",
        `ROUNDLAB_DEBUG_PROJECTILES frontend-test localStorage=${window.localStorage.getItem(PROJECTILE_DEBUG_KEY) ?? "null"}`,
      );
      flashStatus("frontend-test written to browser console.");
    } catch (err) {
      flashStatus(`Write frontend-test failed: ${err}`);
    }
  };

  const handleCopyCapturedLogs = async () => {
    const text = logs.join("\n");
    if (!text) {
      flashStatus("No captured browser logs yet.");
      return;
    }
    await copyTextOrShow("Captured browser logs", text);
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
            <div className="text-[11px] font-semibold text-neutral-300">Browser diagnostics</div>
            <div className="mt-2 grid gap-1 text-[9px] text-neutral-400">
              <div>
                Runtime:{" "}
                <span className="text-emerald-300">
                  {String(debugInfo.runtime ?? "browser")}
                </span>
              </div>
              <div>
                Storage:{" "}
                <span className="text-neutral-300">
                  {String(debugInfo.storage ?? "indexeddb")}
                </span>
              </div>
              <div>
                Projectile debug:{" "}
                <span className={projectileDebug ? "text-emerald-300" : "text-neutral-500"}>
                  {projectileDebug ? "enabled" : "disabled"}
                </span>
              </div>
              <div>
                Captured console lines:{" "}
                <span className={logs.length ? "text-emerald-300" : "text-neutral-500"}>
                  {logs.length}
                </span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
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
                onClick={handleCopyCapturedLogs}
                className="h-6 px-2 text-[10px]"
              >
                Copy captured logs
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
