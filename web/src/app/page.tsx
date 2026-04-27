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
  FileArchive,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
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

export default function Home() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [uploading],
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

  const openMatch = async (id: string) => {
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
              <div className="text-[13px] text-neutral-200">Parsing demo…</div>
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
              if (e.key === "Enter") void confirmPostParse(true);
              if (e.key === "Escape") setPostParse(null);
            }}
            className="w-full rounded-md border bg-black/40 px-3 py-2 text-[13px] text-neutral-100 outline-none focus:border-emerald-300/40"
            style={{ borderColor: "var(--rl-border)" }}
            placeholder="e.g. Anubis vs FaZe — quarterfinals"
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
