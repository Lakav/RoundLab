"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Play, Crosshair } from "lucide-react";

type MatchItem = { id: string; createdAt: number; size: number };

export default function Home() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/matches")
      .then((r) => (r.ok ? r.json() : []))
      .then((items: MatchItem[]) => {
        if (!cancelled) setMatches(items);
      })
      .catch(() => {
        if (!cancelled) setMatches([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const onFile = async (f: File) => {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await r.json();
      if (!r.ok) {
        setError(json.error || "Upload failed");
        return;
      }
      router.push(`/match/${json.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.08),_transparent_60%)]"
      />
      <div className="relative max-w-3xl mx-auto px-6 py-20">
        <div className="flex items-center gap-3 mb-14">
          <div className="size-9 rounded-lg bg-gradient-to-br from-sky-500 to-amber-500 flex items-center justify-center">
            <Crosshair className="size-5 text-neutral-950" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">GOTV Analyser</h1>
            <p className="text-xs text-neutral-500">CS2 demo replay & analysis</p>
          </div>
        </div>

        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className={
            "relative rounded-2xl border-2 border-dashed transition-all cursor-pointer " +
            "flex flex-col items-center justify-center text-center gap-4 py-16 px-8 " +
            (dragOver
              ? "border-sky-400 bg-sky-400/5"
              : uploading
                ? "border-white/10 bg-white/[0.02]"
                : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]")
          }
        >
          {uploading ? (
            <>
              <Loader2 className="size-10 animate-spin text-sky-400" />
              <div>
                <div className="font-medium">Parsing demo…</div>
                <div className="text-sm text-neutral-500 mt-1">
                  This can take 20–60 seconds for a full match.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="size-12 rounded-xl bg-white/5 flex items-center justify-center">
                <Upload className="size-5 text-neutral-400" />
              </div>
              <div>
                <div className="font-medium text-neutral-100">
                  Drop a .dem or .dem.zst file
                </div>
                <div className="text-sm text-neutral-500 mt-1">
                  or click to browse
                </div>
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".dem,.zst"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {matches.length > 0 && (
          <div className="mt-12">
            <h2 className="text-[11px] uppercase tracking-widest font-semibold text-neutral-500 mb-3 px-1">
              Recent matches
            </h2>
            <div className="space-y-2">
              {matches.map((m) => (
                <div
                  key={m.id}
                  onClick={() => router.push(`/match/${m.id}`)}
                  className="group rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all p-4 flex items-center justify-between cursor-pointer"
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
                    className="bg-white text-neutral-950 hover:bg-neutral-200"
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
