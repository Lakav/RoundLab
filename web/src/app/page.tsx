"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Loader2,
  Play,
  Crosshair,
  Clock,
  FileArchive,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  deleteMatch,
  listMatches,
  parseDemo,
  pickDemoFile,
  renameMatch,
  type MatchSummary,
} from "@/lib/api";
import { SettingsPanel } from "@/components/SettingsPanel";
import { UpdateChecker } from "@/components/UpdateChecker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Home() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  // window.prompt / window.confirm are blocked in Tauri's WKWebView, so we
  // render lightweight modals ourselves and stash the pending action here.
  const [renameTarget, setRenameTarget] = useState<MatchSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MatchSummary | null>(null);

  const refreshMatches = useCallback(async (cancelled?: () => boolean) => {
    listMatches()
      .then((items) => {
        if (!cancelled?.()) setMatches(items);
      })
      .catch((e) => {
        if (!cancelled?.()) setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const parsePath = useCallback(
    async (path: string) => {
      if (uploading) return;
      setError(null);
      try {
        setUploading(true);
        const id = await parseDemo(path);
        router.push(`/match/?id=${id}`);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [router, uploading],
  );

  useEffect(() => {
    let cancelled = false;
    refreshMatches(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refreshMatches]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event: { payload: DragDropEvent }) => {
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setDragging(true);
          return;
        }
        if (payload.type === "leave") {
          setDragging(false);
          return;
        }
        setDragging(false);
        const path = payload.paths.find(isDemoPath);
        if (!path) {
          setError("Drop a .dem or .dem.zst file.");
          return;
        }
        void parsePath(path);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // In a plain browser dev session there is no Tauri webview.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [parsePath]);

  const onPickAndParse = async () => {
    if (uploading) return;
    setError(null);
    try {
      const path = await pickDemoFile();
      if (!path) return;
      await parsePath(path);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRename = (match: MatchSummary) => {
    setRenameValue(match.name);
    setRenameTarget(match);
  };

  const confirmRename = async () => {
    const target = renameTarget;
    if (!target) return;
    const next = renameValue.trim();
    setRenameTarget(null);
    if (!next || next === target.name) return;
    try {
      const updated = await renameMatch(target.id, next);
      setMatches((items) => items.map((m) => (m.id === target.id ? updated : m)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = (match: MatchSummary) => {
    setDeleteTarget(match);
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await deleteMatch(target.id);
      setMatches((items) => items.filter((m) => m.id !== target.id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="min-h-screen text-neutral-100" style={{ background: "var(--rl-bg)" }}>
      {/* Shared HUD-style grid background. Same as the review viewport. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:30px_30px]"
      />

      <div className="relative mx-auto max-w-3xl px-6 py-12">
        {/* Top bar: logo + settings button. Mirrors the review HUD corners. */}
        <div className="relative mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex size-9 items-center justify-center rounded-md border"
              style={{
                borderColor: "rgba(110,231,183,0.2)",
                background: "var(--rl-accent-soft)",
              }}
            >
              <Crosshair className="size-4 text-emerald-300" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight">RoundLab</div>
              <div className="text-[10.5px] font-medium uppercase tracking-[0.24em] text-neutral-500">
                Desktop · v0.1
              </div>
            </div>
          </div>
          <SettingsPanel />
        </div>

        {/* Heading — tighter than before, denser, closer to the HUD vocabulary. */}
        <div className="mb-6">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.28em] text-emerald-300">
            Demo to decisions
          </div>
          <h1 className="mt-2 max-w-2xl text-[28px] font-semibold leading-[1.1] tracking-tight text-neutral-100">
            Replay every round, draw the call, fix the mistake.
          </h1>
        </div>

        {/* Upload panel — solid HUD surface, no more dashed card. */}
        <div
          onClick={onPickAndParse}
          role="button"
          tabIndex={0}
          className={[
            "relative flex cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border px-8 py-14 text-center transition-colors",
            uploading
              ? "cursor-wait"
              : dragging
                ? "border-emerald-300/40 bg-emerald-300/[0.04]"
                : "hover:border-emerald-300/25 hover:bg-white/[0.02]",
          ].join(" ")}
          style={{
            background: "var(--rl-panel)",
            borderColor: "var(--rl-border)",
          }}
        >
          {/* Subtle corner ticks to match the viewer's tactical feel. */}
          <CornerTicks />

          {uploading ? (
            <>
              <Loader2 className="size-9 animate-spin text-emerald-300" />
              <div>
                <div className="text-[13px] font-semibold text-neutral-100">
                  Parsing demo…
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  Running the sidecar locally — no upload.
                </div>
              </div>
            </>
          ) : dragging ? (
            <>
              <div className="flex size-11 items-center justify-center rounded-lg border border-emerald-300/20 bg-emerald-300/[0.08]">
                <Upload className="size-4 text-emerald-300" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-neutral-100">
                  Drop to parse this demo
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  .dem and .dem.zst are supported
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex size-11 items-center justify-center rounded-lg border border-white/[0.06] bg-black/40">
                <Upload className="size-4 text-emerald-300" />
              </div>
              <div>
                <div className="text-[13px] font-semibold text-neutral-100">
                  Open a .dem or .dem.zst
                </div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  Click to browse · files never leave your machine
                </div>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 whitespace-pre-wrap rounded-lg border border-red-500/20 bg-red-500/[0.08] px-4 py-3 text-[12px] text-red-300">
            {error}
          </div>
        )}

        <UpdateChecker />

        {/* Recent matches — HUD-style dense rows. */}
        {matches.length > 0 && (
          <div className="mt-10">
            <div className="mb-2 flex items-center justify-between px-0.5">
              <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
                Recent matches
              </h2>
              <div className="text-[10.5px] uppercase tracking-[0.24em] text-neutral-600">
                {matches.length} parsed
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--rl-border)" }}>
              {matches.map((m, i) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  first={i === 0}
                  onOpen={() => router.push(`/match/?id=${m.id}`)}
                  onRename={() => onRename(m)}
                  onDelete={() => onDelete(m)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {renameTarget && (
        <Modal onClose={() => setRenameTarget(null)} title="Rename match">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmRename();
              if (e.key === "Escape") setRenameTarget(null);
            }}
            className="w-full rounded-md border bg-black/40 px-3 py-2 text-[13px] text-neutral-100 outline-none focus:border-emerald-300/40"
            style={{ borderColor: "var(--rl-border)" }}
            placeholder="Match name"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void confirmRename()}>
              Save
            </Button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)} title="Delete match?">
          <p className="text-[12px] text-neutral-400">
            &ldquo;{deleteTarget.name}&rdquo; will be removed from your history.
            This cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void confirmDelete()}
              className="bg-red-500/20 text-red-200 hover:bg-red-500/30"
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border p-5"
        style={{ background: "var(--rl-panel)", borderColor: "var(--rl-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-[13px] font-semibold text-neutral-100">{title}</h3>
        {children}
      </div>
    </div>
  );
}

// ------------------------------ pieces ------------------------------

function CornerTicks() {
  // Four L-shaped ticks in the corners, ~10px long. Visual echo of the
  // radar frame / tactical HUD.
  const tick =
    "pointer-events-none absolute size-3 border-emerald-300/30";
  return (
    <>
      <span className={`${tick} left-2 top-2 border-l border-t`} />
      <span className={`${tick} right-2 top-2 border-r border-t`} />
      <span className={`${tick} bottom-2 left-2 border-b border-l`} />
      <span className={`${tick} bottom-2 right-2 border-b border-r`} />
    </>
  );
}

function MatchRow({
  match: m,
  first,
  onOpen,
  onRename,
  onDelete,
}: {
  match: MatchSummary;
  first: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      className={[
        "group flex cursor-pointer items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.025]",
        first ? "" : "border-t",
      ].join(" ")}
      style={{
        background: "var(--rl-panel)",
        borderColor: "var(--rl-border)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-black/40">
          <FileArchive className="size-3.5 text-neutral-400 group-hover:text-emerald-300" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-neutral-200">
            {m.name}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-neutral-500">
            <Clock className="size-3" />
            {new Date(m.createdAt).toLocaleString()}
            <span className="text-neutral-700">·</span>
            {(m.size / 1024 / 1024).toFixed(1)} MB
            <span className="text-neutral-700">·</span>
            <span className="font-mono">{m.id.slice(0, 8)}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 gap-1.5 rounded-md bg-emerald-300 px-3 text-[11px] font-semibold text-[#06100b] hover:bg-emerald-200"
        >
          <Play className="size-3 fill-current" />
          Open
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            onClick={(e) => e.stopPropagation()}
            render={
              <Button
                aria-label="Match actions"
                variant="ghost"
                size="icon-sm"
                className="text-neutral-500 hover:bg-white/[0.04] hover:text-neutral-100"
              />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-36 border border-white/10 bg-[#171a1a] text-neutral-100"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onClick={onRename} className="text-xs">
              <Pencil className="size-3.5" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              variant="destructive"
              className="text-xs"
            >
              <Trash2 className="size-3.5" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function isDemoPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".dem") || lower.endsWith(".dem.zst") || lower.endsWith(".zst");
}
