"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Loader2,
  Play,
  Crosshair,
  Clock,
  FileArchive,
} from "lucide-react";
import {
  listMatches,
  parseDemo,
  pickDemoFile,
  type MatchSummary,
} from "@/lib/api";
import { SettingsPanel } from "@/components/SettingsPanel";
import { UpdateChecker } from "@/components/UpdateChecker";

export default function Home() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listMatches()
      .then((items) => {
        if (!cancelled) setMatches(items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPickAndParse = async () => {
    if (uploading) return;
    setError(null);
    try {
      const path = await pickDemoFile();
      if (!path) return;
      setUploading(true);
      const id = await parseDemo(path);
      router.push(`/match/?id=${id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
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
                />
              ))}
            </div>
          </div>
        )}
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
}: {
  match: MatchSummary;
  first: boolean;
  onOpen: () => void;
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
          <div className="font-mono text-[12.5px] text-neutral-200">
            {m.id.slice(0, 8)}
            <span className="text-neutral-600">…{m.id.slice(-4)}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-neutral-500">
            <Clock className="size-3" />
            {new Date(m.createdAt).toLocaleString()}
            <span className="text-neutral-700">·</span>
            {(m.size / 1024 / 1024).toFixed(1)} MB
          </div>
        </div>
      </div>
      <Button
        size="sm"
        className="h-7 gap-1.5 rounded-md bg-emerald-300 px-3 text-[11px] font-semibold text-[#06100b] hover:bg-emerald-200"
      >
        <Play className="size-3 fill-current" />
        Open
      </Button>
    </div>
  );
}
