"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Loader2,
  Play,
  Crosshair,
  FileArchive,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  cancelParse,
  deleteMatch,
  getMatchMetadata,
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

type ParseProgress = {
  phase: string;
  progress: number;
  message: string;
};

const PARSE_DURATION_KEY = "roundlab.parseDurationMs";

function formatDuration(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

export default function Home() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState<ParseProgress>({
    phase: "idle",
    progress: 0,
    message: "",
  });
  const [parseStartedAt, setParseStartedAt] = useState<number | null>(null);
  const [parseNow, setParseNow] = useState(() => Date.now());
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  // window.prompt / window.confirm are blocked in Tauri's WKWebView, so we
  // render lightweight modals ourselves and stash the pending action here.
  const [renameTarget, setRenameTarget] = useState<MatchSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MatchSummary | null>(null);
  // After a fresh parse we surface a "name & open" prompt instead of jumping
  // straight into the match — gives the user a chance to label the demo
  // before it lands in the recent list.
  const [postParse, setPostParse] = useState<MatchSummary | null>(null);
  const [postParseName, setPostParseName] = useState("");
  const elapsedMs = parseStartedAt ? Math.max(0, parseNow - parseStartedAt) : 0;
  const storedEstimateMs = (() => {
    if (typeof window === "undefined") return 90_000;
    const raw = Number(window.localStorage.getItem(PARSE_DURATION_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : 90_000;
  })();
  const backendPct = Math.max(0, Math.min(1, parseProgress.progress || 0));
  const timePct = parseStartedAt ? Math.min(0.95, elapsedMs / storedEstimateMs) : 0;
  const shownProgress = uploading
    ? Math.max(0.03, Math.min(0.99, Math.max(backendPct, timePct)))
    : 0;
  const remainingMs =
    uploading && shownProgress > 0.04
      ? Math.max(0, (elapsedMs / shownProgress) * (1 - shownProgress))
      : storedEstimateMs;

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
      const started = Date.now();
      try {
        setUploading(true);
        setParseStartedAt(started);
        setParseNow(started);
        setParseProgress({ phase: "starting", progress: 0.02, message: "Preparing parser…" });
        const id = await parseDemo(path);
        const duration = Date.now() - started;
        try {
          const prev = Number(window.localStorage.getItem(PARSE_DURATION_KEY));
          const next = Number.isFinite(prev) && prev > 0 ? prev * 0.65 + duration * 0.35 : duration;
          window.localStorage.setItem(PARSE_DURATION_KEY, String(Math.round(next)));
        } catch {
          /* ignore */
        }
        // Pull the freshly parsed match summary from the store so we can
        // pre-fill the name prompt and refresh the recent list at the same
        // time. Falls back to a synthetic summary if listing fails.
        const items = await listMatches().catch(() => [] as MatchSummary[]);
        setMatches(items);
        const summary =
          items.find((m) => m.id === id) ?? {
            id,
            name: id.slice(0, 8),
            createdAt: Date.now(),
            size: 0,
          };
        // Don't pre-fill with the auto-generated filename (e.g.
        // "1-0e1c1545-8f49-41a8-bbf3-...-1-1") — that's noise. Let the
        // user type a clean name; if they leave it empty we keep the
        // generated default.
        setPostParseName("");
        setPostParse(summary);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        if (!/cancel/i.test(message)) setError(message);
      } finally {
        setUploading(false);
        setParseStartedAt(null);
        setParseProgress({ phase: "idle", progress: 0, message: "" });
      }
    },
    [uploading],
  );

  useEffect(() => {
    if (!uploading) return;
    const timer = window.setInterval(() => setParseNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [uploading]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<ParseProgress>("parse-progress", (event) => {
      if (!cancelled) setParseProgress(event.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* no Tauri event bus in non-native checks */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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
        if (uploading) return;
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
        // During non-native renderer checks there is no Tauri webview.
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [parsePath, uploading]);

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

  const openMatch = async (id: string) => {
    if (uploading) return;
    setOpening(true);
    // Warm the Rust-side match cache before navigating so MatchViewer's
    // initial getMatchMetadata() call is instant. Failures here aren't
    // fatal — the viewer will retry on its own.
    try {
      await getMatchMetadata(id);
    } catch {
      /* ignore — let MatchViewer surface the real error */
    }
    router.push(`/match/?id=${id}`);
  };

  const onCancelParse = async () => {
    try {
      await cancelParse();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmPostParse = async (open: boolean) => {
    const target = postParse;
    if (!target) return;
    const next = postParseName.trim();
    setPostParse(null);
    if (next && next !== target.name) {
      try {
        const updated = await renameMatch(target.id, next);
        setMatches((items) =>
          items.map((m) => (m.id === target.id ? updated : m)),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    if (open) await openMatch(target.id);
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
    <div
      className="min-h-screen text-neutral-100"
      style={{ background: "#1d1f1f" }}
    >
      {opening && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-7 animate-spin text-emerald-300" />
            <div className="text-[12px] text-neutral-300">Loading match…</div>
          </div>
        </div>
      )}

      {uploading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#171a1a] p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-[13px] font-semibold text-neutral-100">Parsing demo</div>
                <div className="mt-1 text-[11px] text-neutral-500">
                  Interactions are locked until parsing finishes or is cancelled.
                </div>
              </div>
              <Loader2 className="mt-0.5 size-4 animate-spin text-emerald-300" />
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-black/50">
              <div
                className="h-full rounded-full bg-emerald-300 transition-[width] duration-300"
                style={{ width: `${Math.round(shownProgress * 100)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-neutral-400">
              <span>{parseProgress.message || "Parsing…"}</span>
              <span>{Math.round(shownProgress * 100)}%</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
              <span>Elapsed {formatDuration(elapsedMs)}</span>
              <span>About {formatDuration(remainingMs)} left</span>
            </div>
            <div className="mt-5 flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onCancelParse()}
                className="gap-1.5 border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20"
              >
                <X className="size-3.5" />
                Cancel parsing
              </Button>
            </div>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between border-b border-white/[0.06] px-6 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-emerald-300/10">
            <Crosshair className="size-3.5 text-emerald-300" strokeWidth={2.5} />
          </div>
          <span className="text-sm font-semibold">RoundLab</span>
          <span className="text-[11px] text-neutral-500">v0.1.4</span>
        </div>
        <SettingsPanel />
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-12">
        <div
          onClick={onPickAndParse}
          role="button"
          tabIndex={0}
          className={[
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border px-6 py-12 text-center transition-colors",
            uploading
              ? "cursor-wait border-emerald-300/30"
              : dragging
                ? "border-emerald-300/50 bg-emerald-300/[0.04]"
                : "border-white/10 hover:border-emerald-300/30 hover:bg-white/[0.02]",
          ].join(" ")}
        >
          {uploading ? (
            <>
              <Loader2 className="size-6 animate-spin text-emerald-300" />
              <div className="w-full max-w-xs">
                <div className="text-[13px] text-neutral-200">Parsing demo…</div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/40">
                  <div
                    className="h-full rounded-full bg-emerald-300 transition-[width] duration-300"
                    style={{ width: `${Math.round(shownProgress * 100)}%` }}
                  />
                </div>
                <div className="mt-2 text-[11px] text-neutral-500">
                  {formatDuration(elapsedMs)} elapsed · about {formatDuration(remainingMs)} left
                </div>
              </div>
            </>
          ) : (
            <>
              <Upload className="size-6 text-emerald-300" strokeWidth={2} />
              <div>
                <div className="text-[14px] font-medium text-neutral-100">
                  {dragging ? "Drop to parse" : "Open a CS2 demo"}
                </div>
                <div className="mt-1 text-[12px] text-neutral-500">
                  Drop a .dem or .dem.zst, or click to browse
                </div>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-200">
            {error}
          </div>
        )}

        <UpdateChecker />

        {matches.length > 0 && (
          <section className="space-y-2">
            <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
              Recent matches
            </h2>
            <div className="overflow-hidden rounded-lg border border-white/[0.08]">
              {matches.map((m, i) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  first={i === 0}
                  onOpen={() => void openMatch(m.id)}
                  onRename={() => onRename(m)}
                  onDelete={() => onDelete(m)}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      {renameTarget && (
        <Modal onClose={() => setRenameTarget(null)} title="Rename match">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void confirmRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setRenameTarget(null);
              }
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

      {postParse && (
        <Modal onClose={() => setPostParse(null)} title="Match parsed">
          <p className="mb-3 text-[11px] text-neutral-500">
            Give it a name so it&rsquo;s easy to find later. Leave empty to
            skip.
          </p>
          <input
            autoFocus
            value={postParseName}
            onChange={(e) => setPostParseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void confirmPostParse(true);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setPostParse(null);
              }
            }}
            className="w-full rounded-md border bg-black/40 px-3 py-2 text-[13px] text-neutral-100 outline-none focus:border-emerald-300/40"
            style={{ borderColor: "var(--rl-border)" }}
            placeholder={postParse.name}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void confirmPostParse(false)}
            >
              Save &amp; stay
            </Button>
            <Button size="sm" onClick={() => void confirmPostParse(true)}>
              Save &amp; open
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
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      onKeyDownCapture={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
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
  const date = new Date(m.createdAt);
  return (
    <div
      onClick={onOpen}
      className={[
        "group flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025]",
        first ? "" : "border-t border-white/[0.05]",
      ].join(" ")}
    >
      <FileArchive className="size-4 shrink-0 text-neutral-500 group-hover:text-emerald-300" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-neutral-100">
          {m.name}
        </div>
        <div className="mt-0.5 text-[11px] text-neutral-500">
          {date.toLocaleString()} · {(m.size / 1024 / 1024).toFixed(1)} MB
        </div>
      </div>
      <Button
        size="sm"
        className="h-7 gap-1.5 bg-emerald-300 px-3 text-[11px] font-medium text-[#06100b] hover:bg-emerald-200"
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
  );
}

function isDemoPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".dem") || lower.endsWith(".dem.zst") || lower.endsWith(".zst");
}
