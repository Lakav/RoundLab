"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Loader2,
  Play,
  FileArchive,
  MoreHorizontal,
  Pencil,
  Trash2,
  Download,
  X,
} from "lucide-react";
import {
  cancelParse,
  deleteMatch,
  getMatchMetadata,
  listMatches,
  onParseProgress,
  parseDemo,
  renameMatch,
  type DemoSource,
  type MatchSummary,
  type ParseProgress,
} from "@/lib/api";
import {
  LARGE_DEMO_HIGH_QUALITY_THRESHOLD,
  type BrowserParseMode,
} from "@/lib/parser-memory";
import { assetPath } from "@/lib/paths";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StoragePanel, downloadLibraryBackup } from "@/components/storage/StoragePanel";

const PARSE_DURATION_KEY = "roundlab.parseDurationMs";
const PARSE_ESTIMATE_KEY = "roundlab.parseEstimate.v2";
const MAX_DEMO_SIZE = 1024 * 1024 * 1024;
const FALLBACK_PARSE_ESTIMATE_MS = 90_000;
const FALLBACK_WEB_MS_PER_MB = 160;
const FALLBACK_ZSTD_EXPANSION_RATIO = 1.6;
const MIN_ZSTD_WEB_MS_PER_MB = 135;
const MIN_WEB_PARSE_ESTIMATE_MS = 12_000;
const MIN_WEB_MS_PER_MB = 20;
const MAX_WEB_MS_PER_MB = 10_000;
const MIN_ZSTD_EXPANSION_RATIO = 1.05;
const MAX_ZSTD_EXPANSION_RATIO = 12;

function formatDuration(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
}

function formatFileSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 / 1024))} MB`;
}

function parseSourceSize(source: DemoSource): number | null {
  return source.file.size;
}

function sourceIsZstd(source: DemoSource): boolean {
  const lower = source.file.name.toLowerCase();
  return lower.endsWith(".zst") || lower.endsWith(".dem.zst");
}

function boundedNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function loadWebParseEstimate(): { webMsPerMb?: number; zstdExpansionRatio?: number } {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PARSE_ESTIMATE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const values = parsed as {
      webMsPerMb?: number;
      zstdExpansionRatio?: number;
    };
    return {
      webMsPerMb: boundedNumber(values.webMsPerMb, MIN_WEB_MS_PER_MB, MAX_WEB_MS_PER_MB),
      zstdExpansionRatio: boundedNumber(values.zstdExpansionRatio, MIN_ZSTD_EXPANSION_RATIO, MAX_ZSTD_EXPANSION_RATIO),
    };
  } catch {
    return {};
  }
}

function loadLegacyParseEstimate(): number {
  if (typeof window === "undefined") return FALLBACK_PARSE_ESTIMATE_MS;
  const raw = Number(window.localStorage.getItem(PARSE_DURATION_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_PARSE_ESTIMATE_MS;
}

function webEstimateForBytes(bytes: number, minMsPerMb = 0): number {
  if (typeof window === "undefined") {
    return Math.max(MIN_WEB_PARSE_ESTIMATE_MS, (bytes / 1024 / 1024) * Math.max(FALLBACK_WEB_MS_PER_MB, minMsPerMb));
  }
  const parsed = loadWebParseEstimate();
  const msPerMb = parsed.webMsPerMb ?? FALLBACK_WEB_MS_PER_MB;
  return Math.max(MIN_WEB_PARSE_ESTIMATE_MS, (bytes / 1024 / 1024) * Math.max(msPerMb, minMsPerMb));
}

function estimateForSource(source: DemoSource): number {
  const size = parseSourceSize(source);
  if (!size) return loadLegacyParseEstimate();
  const parsed = loadWebParseEstimate();
  const expansionRatio =
    sourceIsZstd(source) && parsed.zstdExpansionRatio
      ? parsed.zstdExpansionRatio
      : sourceIsZstd(source)
        ? FALLBACK_ZSTD_EXPANSION_RATIO
        : 1;
  return webEstimateForBytes(size * expansionRatio, sourceIsZstd(source) ? MIN_ZSTD_WEB_MS_PER_MB : 0);
}

function saveParseEstimate(source: DemoSource, durationMs: number, effectiveBytes?: number | null): void {
  if (typeof window === "undefined") return;
  const rawSize = parseSourceSize(source);
  const size = effectiveBytes && effectiveBytes > 0 ? effectiveBytes : rawSize;
  try {
    if (size) {
      const observed = boundedNumber(durationMs / Math.max(1, size / 1024 / 1024), MIN_WEB_MS_PER_MB, MAX_WEB_MS_PER_MB);
      const parsed = loadWebParseEstimate();
      const prev = parsed.webMsPerMb ?? observed ?? FALLBACK_WEB_MS_PER_MB;
      const next = observed ? prev * 0.65 + observed * 0.35 : prev;
      const ratioObserved =
        sourceIsZstd(source) && rawSize && effectiveBytes && effectiveBytes > rawSize
          ? boundedNumber(effectiveBytes / rawSize, MIN_ZSTD_EXPANSION_RATIO, MAX_ZSTD_EXPANSION_RATIO)
          : null;
      const previousRatio = parsed.zstdExpansionRatio ?? ratioObserved ?? FALLBACK_ZSTD_EXPANSION_RATIO;
      const zstdExpansionRatio = ratioObserved
        ? previousRatio * 0.65 + ratioObserved * 0.35
        : parsed.zstdExpansionRatio;
      window.localStorage.setItem(
        PARSE_ESTIMATE_KEY,
        JSON.stringify({
          webMsPerMb: Math.round(next),
          ...(zstdExpansionRatio ? { zstdExpansionRatio: Number(zstdExpansionRatio.toFixed(2)) } : {}),
        }),
      );
    } else {
      const prev = Number(window.localStorage.getItem(PARSE_DURATION_KEY));
      const next = Number.isFinite(prev) && prev > 0 ? prev * 0.65 + durationMs * 0.35 : durationMs;
      window.localStorage.setItem(PARSE_DURATION_KEY, String(Math.round(next)));
    }
  } catch {
    /* ignore */
  }
}

function browserSupportError(): string | null {
  if (typeof window === "undefined") return null;
  const missing: string[] = [];
  if (typeof Worker === "undefined") missing.push("Web Workers");
  if (typeof WebAssembly === "undefined") missing.push("WebAssembly");
  if (!("indexedDB" in window)) missing.push("IndexedDB");
  if (typeof File === "undefined" || typeof Blob === "undefined") missing.push("File API");
  if (!globalThis.crypto?.randomUUID) missing.push("crypto.randomUUID");
  if (!missing.length) return null;
  return `This browser cannot run RoundLab's local parser. Missing: ${missing.join(", ")}.`;
}

function demoFileSizeError(file: File): string | null {
  if (file.size <= MAX_DEMO_SIZE) return null;
  return "Demo file is larger than the 1 GB browser parser limit.";
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
  // Browser prompts are awkward to style and easy to block, so use lightweight
  // in-app modals for rename/delete and post-parse naming.
  const [renameTarget, setRenameTarget] = useState<MatchSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MatchSummary | null>(null);
  // After a fresh parse we surface a "name & open" prompt instead of jumping
  // straight into the match — gives the user a chance to label the demo
  // before it lands in the recent list.
  const [postParse, setPostParse] = useState<MatchSummary | null>(null);
  const [postParseName, setPostParseName] = useState("");
  const [pendingSource, setPendingSource] = useState<DemoSource | null>(null);
  const [parseMode, setParseMode] = useState<BrowserParseMode>("fast");
  const [parseEstimateMs, setParseEstimateMs] = useState(FALLBACK_PARSE_ESTIMATE_MS);
  const parseEffectiveBytesRef = useRef<number | null>(null);
  const parseMinMsPerMbRef = useRef(0);
  const parseInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const elapsedMs = parseStartedAt ? Math.max(0, parseNow - parseStartedAt) : 0;
  const backendPct = Math.max(0, Math.min(1, parseProgress.progress || 0));
  const timePct = parseStartedAt ? Math.min(0.95, elapsedMs / parseEstimateMs) : 0;
  // Once the backend is past 95%, stop blending with the time-based estimate —
  // the time estimate's job is to keep the bar moving while we wait for the
  // first real progress event, not to compete with late-stage real progress.
  // Without this, a slow gzip flush on Windows pins the bar at the cap and
  // looks frozen even though the parser is making progress.
  const blended = backendPct > 0.95 ? backendPct : Math.max(backendPct, timePct);
  const shownProgress = uploading ? Math.max(0.03, Math.min(0.99, blended)) : 0;
  const backendEstimatedTotalMs =
    uploading && parseStartedAt && backendPct >= 0.35
      ? Math.max(elapsedMs, elapsedMs / backendPct)
      : null;
  const effectiveEstimateMs = backendEstimatedTotalMs ?? parseEstimateMs;
  const remainingMs =
    uploading && parseStartedAt
      ? Math.max(0, effectiveEstimateMs - elapsedMs)
      : parseEstimateMs;
  const estimateExceeded = uploading && parseStartedAt && elapsedMs >= effectiveEstimateMs && backendPct < 0.95;

  const refreshMatches = useCallback(async (cancelled?: () => boolean) => {
    try {
      const items = await listMatches();
      if (!cancelled?.()) setMatches(items);
    } catch (cause) {
      if (!cancelled?.()) setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const parseSource = useCallback(
    async (source: DemoSource, mode: BrowserParseMode) => {
      // State updates are asynchronous: two file/drop events can otherwise
      // both enter here before `uploading` is rendered as true. The backend
      // then cancels the first parse and its `finally` hides the second one's
      // progress dialog while it is still running.
      if (parseInFlightRef.current) return;
      const sizeError = demoFileSizeError(source.file);
      if (sizeError) {
        setError(sizeError);
        return;
      }
      if (mode === "precise" && source.file.size >= LARGE_DEMO_HIGH_QUALITY_THRESHOLD) {
        setError(
          "Maximum precision is unavailable for this large demo because it would exceed the browser memory limit. Use Fast / memory-safe mode.",
        );
        return;
      }
      parseInFlightRef.current = true;
      setError(null);
      const started = Date.now();
      const estimate = estimateForSource(source);
      try {
        setUploading(true);
        setParseStartedAt(started);
        setParseNow(started);
        parseEffectiveBytesRef.current = parseSourceSize(source);
        parseMinMsPerMbRef.current = sourceIsZstd(source) ? MIN_ZSTD_WEB_MS_PER_MB : 0;
        setParseEstimateMs(estimate);
        setParseProgress({ phase: "starting", progress: 0.02, message: "Preparing parser…" });
        const id = await parseDemo(source, { mode });
        const duration = Date.now() - started;
        saveParseEstimate(source, duration, parseEffectiveBytesRef.current);
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
        parseInFlightRef.current = false;
        setUploading(false);
        setParseStartedAt(null);
        parseEffectiveBytesRef.current = null;
        parseMinMsPerMbRef.current = 0;
        setParseProgress({ phase: "idle", progress: 0, message: "" });
      }
    },
    [],
  );

  useEffect(() => {
    if (!uploading) return;
    const timer = window.setInterval(() => setParseNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [uploading]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    onParseProgress((progress) => {
      if (!cancelled) {
        if (progress.effectiveBytes && progress.effectiveBytes > 0) {
          parseEffectiveBytesRef.current = progress.effectiveBytes;
          setParseEstimateMs((current) => Math.max(current, webEstimateForBytes(progress.effectiveBytes ?? 0, parseMinMsPerMbRef.current)));
        }
        setParseProgress(progress);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* progress listeners are best-effort across backends */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listMatches()
      .then((items) => {
        if (!cancelled) setMatches(items);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPickAndParse = () => {
    if (uploading) return;
    const supportError = browserSupportError();
    if (supportError) {
      setError(supportError);
      return;
    }
    setError(null);
    fileInputRef.current?.click();
  };

  const queueImport = (file: File) => {
    if (file.size >= LARGE_DEMO_HIGH_QUALITY_THRESHOLD) setParseMode("fast");
    setPendingSource({ kind: "file", file });
  };

  const onFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file || uploading) return;
    const supportError = browserSupportError();
    if (supportError) {
      setError(supportError);
      return;
    }
    if (!isDemoFile(file)) {
      setError("Choose a .dem or .dem.zst file.");
      return;
    }
    queueImport(file);
  };

  const onImportKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPickAndParse();
  };

  const onBrowserDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    const supportError = browserSupportError();
    if (supportError) {
      setError(supportError);
      return;
    }
    const file = Array.from(event.dataTransfer.files).find(isDemoFile);
    if (!file) {
      setError("Drop a .dem or .dem.zst file.");
      return;
    }
    queueImport(file);
  };

  const startPendingImport = () => {
    const source = pendingSource;
    if (!source) return;
    setPendingSource(null);
    void parseSource(source, parseMode);
  };

  const openMatch = async (id: string, visualTest = false) => {
    if (uploading) return;
    setOpening(true);
    // Warm the match metadata before navigating. Failures here aren't fatal;
    // the viewer will retry and show the real error if needed.
    try {
      await getMatchMetadata(id);
    } catch {
      /* ignore — let MatchViewer surface the real error */
    }
    router.push(`/match/?id=${id}${visualTest ? "&visualTest=1" : ""}`);
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
    if (open) await openMatch(target.id, false);
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

  const onExport = async (match: MatchSummary) => {
    try {
      setError(null);
      await downloadLibraryBackup(match.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L’export a échoué.");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d100f] text-neutral-100">
      <div className="product-grid pointer-events-none absolute inset-x-0 top-0 h-[42rem] opacity-70" />
      {opening && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-7 animate-spin text-emerald-300" />
            <div className="text-[12px] text-neutral-300">Loading match…</div>
          </div>
        </div>
      )}

      {uploading && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="parse-dialog-title"
          aria-describedby="parse-dialog-description"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#171a1a] p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div id="parse-dialog-title" className="text-[13px] font-semibold text-neutral-100">Parsing demo</div>
                <div id="parse-dialog-description" className="mt-1 text-[11px] text-neutral-400">
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
            <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-400">
              <span>Elapsed {formatDuration(elapsedMs)}</span>
              <span>{estimateExceeded ? "Still parsing" : `About ${formatDuration(remainingMs)} left`}</span>
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

      <header className="relative z-10 border-b border-white/[0.07] bg-[#0d100f]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Image
              src={assetPath("/logo.png")}
              alt=""
              width={28}
              height={29}
              loading="eager"
              className="object-contain"
            />
            <h1 className="text-[15px] font-semibold tracking-[-0.01em]">RoundLab</h1>
            <span className="rounded border border-emerald-200/15 bg-emerald-200/[0.055] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-200/80">
              Bêta
            </span>
          </div>
          <nav aria-label="Navigation principale" className="flex items-center gap-1">
            <Link
              href="/feedback"
              className="rounded-md px-3 py-2 text-xs font-semibold text-neutral-400 transition-colors hover:bg-white/[0.04] hover:text-neutral-100"
            >
              Signaler un bug
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
        <input
          ref={fileInputRef}
          data-testid="demo-file-input"
          type="file"
          accept=".dem,.zst,.dem.zst"
          aria-label="Choose a local CS2 demo file"
          className="sr-only"
          tabIndex={-1}
          onChange={onFileSelected}
        />
        <section className="grid items-stretch gap-8 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex flex-col justify-center py-3 lg:py-8">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200/70">
              Analyse locale de démos CS2
            </span>
            <h2 className="mt-4 max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-5xl">
              Lis ton match avec des faits, pas des approximations.
            </h2>
            <p className="mt-5 max-w-lg text-[15px] leading-7 text-neutral-400">
              RoundLab transforme une démo CS2 en replay interactif et en rapport statistique détaillé.
              L’analyse reste dans ton navigateur.
            </p>
            <div className="mt-7 grid max-w-lg grid-cols-3 border-y border-white/[0.07] py-4">
              <div>
                <div className="text-sm font-semibold text-neutral-100">Local</div>
                <div className="mt-1 text-[11px] text-neutral-500">Aucun upload serveur</div>
              </div>
              <div className="border-l border-white/[0.07] pl-4">
                <div className="text-sm font-semibold text-neutral-100">Détaillé</div>
                <div className="mt-1 text-[11px] text-neutral-500">Rounds et joueurs</div>
              </div>
              <div className="border-l border-white/[0.07] pl-4">
                <div className="text-sm font-semibold text-neutral-100">Rejouable</div>
                <div className="mt-1 text-[11px] text-neutral-500">Preuves sur la map</div>
              </div>
            </div>
          </div>

          <article className="overflow-hidden rounded-xl border border-white/[0.09] bg-[#131716]/95 shadow-[0_30px_90px_rgba(0,0,0,0.35)]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Importer une démo</h3>
                <p className="mt-1 text-[11px] text-neutral-500">Formats .dem et .dem.zst · limite 1 Go</p>
              </div>
              <span className="text-[10px] font-medium text-neutral-600">Traitement local</span>
            </div>
            <div
              onClick={onPickAndParse}
              onKeyDown={onImportKeyDown}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setDragging(false);
              }}
              onDrop={onBrowserDrop}
              role="button"
              aria-label="Open a local CS2 demo file"
              aria-disabled={uploading}
              tabIndex={0}
              className={[
                "group m-4 flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-6 py-12 text-center outline-none transition-all focus-visible:ring-2 focus-visible:ring-emerald-200/60",
                uploading
                  ? "cursor-wait border-emerald-300/30 bg-emerald-300/[0.025]"
                  : dragging
                    ? "border-emerald-300/55 bg-emerald-300/[0.055]"
                    : "border-white/12 bg-black/10 hover:border-emerald-300/32 hover:bg-emerald-300/[0.02]",
              ].join(" ")}
            >
              {uploading ? (
                <>
                  <Loader2 className="size-6 animate-spin text-emerald-300" />
                  <div className="mt-3 w-full max-w-xs">
                    <div className="text-[13px] text-neutral-200">Analyse de la démo…</div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/40">
                      <div
                        className="h-full rounded-full bg-emerald-300 transition-[width] duration-300"
                        style={{ width: `${Math.round(shownProgress * 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 text-[11px] text-neutral-400">
                      {formatDuration(elapsedMs)} écoulées · {estimateExceeded ? "analyse en cours" : `environ ${formatDuration(remainingMs)} restantes`}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex size-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] transition-colors group-hover:border-emerald-200/20 group-hover:bg-emerald-200/[0.05]">
                    <Upload className="size-5 text-emerald-200/85" strokeWidth={1.8} />
                  </div>
                  <div className="mt-4">
                    <div className="text-[14px] font-semibold text-neutral-100">
                      {dragging ? "Dépose la démo ici" : "Open a CS2 demo"}
                    </div>
                    <div className="mt-1.5 text-[12px] text-neutral-500">
                      Glisse un fichier ou clique pour le sélectionner
                    </div>
                  </div>
                  <span className="mt-5 rounded border border-white/[0.08] px-2.5 py-1 text-[10px] font-medium text-neutral-500">
                    Les données ne quittent pas cet appareil
                  </span>
                </>
              )}
            </div>
          </article>
        </section>

        {error && (
          <div role="alert" className="whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-[12px] text-red-200">
            {error}
          </div>
        )}

        <aside className="grid gap-5 rounded-xl border border-amber-100/10 bg-[#171714] px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center sm:px-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-100/55">Version bêta</div>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-6 text-neutral-200">
              RoundLab évolue régulièrement : certaines statistiques et interfaces peuvent encore changer.
            </p>
            <p className="mt-1 text-xs leading-5 text-neutral-400">
              La bêta est entièrement gratuite. L’application finale sera payante lorsque sa version stable sera disponible.
            </p>
          </div>
          <Link
            href="/feedback"
            className="inline-flex h-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.035] px-4 text-xs font-semibold text-neutral-200 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
          >
            Signaler un problème
          </Link>
        </aside>

        <StoragePanel matchCount={matches.length} onLibraryChanged={refreshMatches} />

        {matches.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-end justify-between px-1">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-neutral-400">Bibliothèque locale</span>
                <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-neutral-100">
                  Matchs récents
                </h2>
              </div>
              <span className="text-[11px] tabular-nums text-neutral-400">{matches.length} enregistré{matches.length > 1 ? "s" : ""}</span>
            </div>
            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#121514]/85 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
              {matches.map((m, i) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  first={i === 0}
                  onOpen={() => void openMatch(m.id)}
                  onRename={() => onRename(m)}
                  onExport={() => void onExport(m)}
                  onDelete={() => onDelete(m)}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between border-t border-white/[0.06] px-5 py-6 text-[11px] text-neutral-400 sm:px-8">
        <span>RoundLab · Analyse locale de démos CS2</span>
        <Link href="/feedback" className="transition-colors hover:text-neutral-300">Signaler un bug</Link>
      </footer>

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
          <p className="mb-3 text-[11px] text-neutral-400">
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

      {pendingSource && (
        <Modal onClose={() => setPendingSource(null)} title="Import settings">
          <div className="mb-4 rounded-md border border-white/10 bg-black/20 px-3 py-2">
            <div className="truncate text-[12px] text-neutral-200">{pendingSource.file.name}</div>
            <div className="mt-0.5 text-[10px] text-neutral-500">{formatFileSize(pendingSource.file.size)}</div>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-[11px] font-medium uppercase tracking-wider text-neutral-400">
              Parsing mode
            </legend>
            <label className="flex cursor-pointer gap-3 rounded-md border border-white/10 px-3 py-3 hover:border-emerald-300/30">
              <input
                type="radio"
                name="parse-mode"
                value="fast"
                checked={parseMode === "fast"}
                onChange={() => setParseMode("fast")}
                className="mt-0.5 accent-emerald-300"
              />
              <span>
                <span className="block text-[12px] font-medium text-neutral-100">Fast / memory-safe</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-neutral-400">
                  About 4 player positions per second, smoothly interpolated. Utilities and events are preserved.
                </span>
              </span>
            </label>
            <label
              className={[
                "flex gap-3 rounded-md border px-3 py-3",
                pendingSource.file.size >= LARGE_DEMO_HIGH_QUALITY_THRESHOLD
                  ? "cursor-not-allowed border-white/5 opacity-45"
                  : "cursor-pointer border-white/10 hover:border-emerald-300/30",
              ].join(" ")}
            >
              <input
                type="radio"
                name="parse-mode"
                value="precise"
                checked={parseMode === "precise"}
                disabled={pendingSource.file.size >= LARGE_DEMO_HIGH_QUALITY_THRESHOLD}
                onChange={() => setParseMode("precise")}
                className="mt-0.5 accent-emerald-300"
              />
              <span>
                <span className="block text-[12px] font-medium text-neutral-100">Maximum precision</span>
                <span className="mt-1 block text-[11px] leading-relaxed text-neutral-400">
                  Keeps all 64 player ticks per second. Slower and only available when the demo fits safely in browser memory.
                </span>
              </span>
            </label>
          </fieldset>
          {pendingSource.file.size >= LARGE_DEMO_HIGH_QUALITY_THRESHOLD && (
            <p role="status" className="mt-3 text-[11px] leading-relaxed text-amber-200/80">
              This file is already too large for maximum precision. The safe mode is required to prevent another memory crash.
            </p>
          )}
          {sourceIsZstd(pendingSource) && pendingSource.file.size < LARGE_DEMO_HIGH_QUALITY_THRESHOLD && (
            <p className="mt-3 text-[10px] leading-relaxed text-neutral-500">
              Compressed demos are checked again after decompression. If the expanded file is too large, RoundLab will ask you to use safe mode.
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPendingSource(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={startPendingImport}>
              Start import
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
  const titleId = useId();

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const firstFocusable = panel.querySelector<HTMLElement>(
      "input, select, textarea, button, [href], [tabindex]:not([tabindex='-1'])",
    );
    (firstFocusable ?? panel).focus();
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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl border p-5"
        style={{ background: "var(--rl-panel)", borderColor: "var(--rl-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="mb-3 text-[13px] font-semibold text-neutral-100">{title}</h3>
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
  onExport,
  onDelete,
}: {
  match: MatchSummary;
  first: boolean;
  onOpen: () => void;
  onRename: () => void;
  onExport: () => void;
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
      <FileArchive className="size-4 shrink-0 text-neutral-400 group-hover:text-emerald-300" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-neutral-100">
          {m.name}
        </div>
        <div className="mt-0.5 text-[11px] text-neutral-400">
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
              className="text-neutral-400 hover:bg-white/[0.04] hover:text-neutral-100"
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
          <DropdownMenuItem onClick={onExport} className="text-xs">
            <Download className="size-3.5" />
            Exporter
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

function isDemoFile(file: File): boolean {
  return isDemoPath(file.name);
}
