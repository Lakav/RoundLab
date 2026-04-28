"use client";

import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, Loader2, RefreshCw } from "lucide-react";

/** Status machine:
 *  - idle       → no known update, no action taken
 *  - checking   → background check in flight on mount
 *  - available  → an update is ready to download
 *  - downloading→ user clicked "Install", payload streaming in
 *  - ready      → download finished; waiting for user to relaunch
 *  - error      → displayed discreetly, doesn't block the home page
 */
type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; pct: number }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export function UpdateChecker() {
  // Start in "checking" so we don't need to call setStatus synchronously in the
  // effect — React 19's `react-hooks/set-state-in-effect` rule flags that.
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  // Check once on mount. The Tauri side silently falls through if we're running
  // in `tauri dev` without a real endpoint configured — so this is safe.
  useEffect(() => {
    let cancelled = false;
    check()
      .then((update) => {
        if (cancelled) return;
        if (update) {
          setStatus({ kind: "available", update });
        } else {
          setStatus({ kind: "idle" });
        }
      })
      .catch((e) => {
        if (cancelled) return;
        // Don't surface errors loudly — most common cause is a dev build.
        // We keep the message around in case we want to show it later.
        setStatus({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const install = async () => {
    if (status.kind !== "available") return;
    const update = status.update;
    try {
      let downloaded = 0;
      let contentLength = 0;
      setStatus({ kind: "downloading", pct: 0 });
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct =
            contentLength > 0 ? (downloaded / contentLength) * 100 : 0;
          setStatus({ kind: "downloading", pct });
        } else if (event.event === "Finished") {
          setStatus({ kind: "ready" });
        }
      });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  if (status.kind === "idle" || status.kind === "checking") return null;
  if (status.kind === "error") return null;

  return (
    <div
      className="mt-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-[12px]"
      style={{
        background: "var(--rl-panel)",
        borderColor: "rgba(110,231,183,0.25)",
      }}
    >
      <div className="flex items-center gap-2 text-neutral-200">
        {status.kind === "available" && (
          <>
            <Download className="size-3.5 text-emerald-300" />
            <span>
              Update available
              <span className="ml-2 font-mono text-neutral-500">
                v{status.update.version}
              </span>
            </span>
          </>
        )}
        {status.kind === "downloading" && (
          <>
            <Loader2 className="size-3.5 animate-spin text-emerald-300" />
            <span>Downloading… {Math.round(status.pct)}%</span>
          </>
        )}
        {status.kind === "ready" && (
          <>
            <RefreshCw className="size-3.5 text-emerald-300" />
            <span>Update ready — restart to apply.</span>
          </>
        )}
      </div>

      {status.kind === "available" && (
        <button
          type="button"
          onClick={install}
          className="rounded-md bg-emerald-300 px-3 py-1 text-[11px] font-semibold text-[#06100b] transition-colors hover:bg-emerald-200"
        >
          Install
        </button>
      )}
      {status.kind === "ready" && (
        <button
          type="button"
          onClick={() => relaunch()}
          className="rounded-md bg-emerald-300 px-3 py-1 text-[11px] font-semibold text-[#06100b] transition-colors hover:bg-emerald-200"
        >
          Restart
        </button>
      )}
    </div>
  );
}
