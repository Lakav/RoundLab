"use client";

import { useEffect, useState } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDebugInfo } from "@/lib/api";

export function DebugConsole({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [expanded, setExpanded] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!isOpen) return;

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    const captureLog = (prefix: string, ...args: any[]) => {
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

    const timer = setInterval(pollDebugInfo, 500);

    return () => {
      clearInterval(timer);
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
    };
  }, [isOpen]);

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
