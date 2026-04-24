"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Play, Crosshair } from "lucide-react";
import { listMatches, parseDemo, pickDemoFile, type MatchSummary } from "@/lib/api";

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
    <div className="min-h-screen bg-[#060807] text-neutral-100">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:30px_30px]"
      />
      <div className="relative mx-auto max-w-3xl px-6 py-16">
        <div className="flex items-center gap-3 mb-14">
          <div className="flex size-10 items-center justify-center rounded border border-emerald-400/20 bg-emerald-400/10">
            <Crosshair className="size-5 text-emerald-300" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">RoundLab</h1>
            <p className="text-xs text-neutral-500">CS2 round review workspace · Desktop</p>
          </div>
        </div>

        <div className="mb-8">
          <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-300">
            Demo to decisions
          </div>
          <p className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight text-neutral-100">
            Replay every round, draw the call, fix the mistake.
          </p>
        </div>

        <div
          onClick={onPickAndParse}
          className={
            "relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-8 py-16 text-center transition-all " +
            (uploading
              ? "border-white/10 bg-black/20"
              : "border-white/10 bg-black/20 hover:border-emerald-300/30 hover:bg-white/[0.035]")
          }
        >
          {uploading ? (
            <>
              <Loader2 className="size-10 animate-spin text-emerald-300" />
              <div>
                <div className="font-medium">Parsing demo…</div>
                <div className="text-sm text-neutral-500 mt-1">
                  This can take 20–60 seconds for a full match.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex size-12 items-center justify-center rounded-xl bg-white/[0.04]">
                <Upload className="size-5 text-emerald-300" />
              </div>
              <div>
                <div className="font-medium text-neutral-100">
                  Choose a .dem file
                </div>
                <div className="text-sm text-neutral-500 mt-1">
                  Click to browse — parsing happens locally, nothing uploaded.
                </div>
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-3 text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}

        {matches.length > 0 && (
          <div className="mt-12">
            <h2 className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-600">
              Recent matches
            </h2>
            <div className="space-y-2">
              {matches.map((m) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/match/?id=${m.id}`)}
                  className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 p-4 transition-all hover:border-emerald-300/20 hover:bg-white/[0.035]"
                >
                  <div>
                    <div className="font-mono text-sm text-neutral-200">
                      {m.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {new Date(m.createdAt).toLocaleString()} ·{" "}
                      {(m.size / 1024 / 1024).toFixed(1)} MB
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-emerald-300 text-[#06100b] hover:bg-emerald-200"
                  >
                    <Play className="size-3.5 fill-current" /> Open
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
