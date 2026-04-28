"use client";

import { useState } from "react";
import {
  DEFAULT_PARSE_OPTIONS,
  loadParseOptions,
  saveParseOptions,
  type ParseOptions,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { X, Settings } from "lucide-react";

/** Renders a small gear button. Clicking it opens an inline panel where the
 *  user can tune parse-quality and capture toggles. Changes are persisted to
 *  localStorage immediately and will apply to the next parse. */
export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  // Lazy initializer: reads localStorage once, on the client, so we avoid a
  // flash of defaults and never call setState from inside an effect.
  const [opts, setOpts] = useState<ParseOptions>(() =>
    typeof window === "undefined" ? DEFAULT_PARSE_OPTIONS : loadParseOptions(),
  );

  const update = (patch: Partial<ParseOptions>) => {
    const next = { ...opts, ...patch };
    setOpts(next);
    saveParseOptions(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        className="flex size-8 items-center justify-center rounded-md border border-white/[0.06] bg-black/30 text-neutral-400 transition-colors hover:border-white/[0.12] hover:text-neutral-100"
      >
        <Settings className="size-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-20 w-[360px] rounded-xl border border-white/[0.08] bg-[#121414] p-4 shadow-2xl shadow-black/60">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
              Parse settings
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-1 text-neutral-500 hover:text-neutral-200"
              aria-label="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="space-y-4">
            <Field
              label="Sampling quality"
              hint="Higher fidelity = larger files and longer parse time, but smoother replays."
            >
              <div className="flex gap-1">
                {(["low", "medium", "high", "full"] as const).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => update({ quality: q })}
                    className={[
                      "flex-1 rounded-md border px-2 py-1.5 text-xs font-medium capitalize transition-colors",
                      opts.quality === q
                        ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-200"
                        : "border-white/[0.08] bg-black/20 text-neutral-400 hover:border-white/[0.14] hover:text-neutral-200",
                    ].join(" ")}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <p className="text-[10.5px] leading-snug text-neutral-500">
                full ≈ 8 Hz · high ≈ 4 Hz · medium ≈ 2 Hz · low ≈ 1 Hz
              </p>
            </Field>

            <Toggle
              label="Capture projectile positions"
              hint="Per-frame grenade trajectories. Costs a few MB per match."
              checked={!opts.skipProjectiles}
              onChange={(v) => update({ skipProjectiles: !v })}
            />

            <Toggle
              label="Capture weapon fires"
              hint="Every shot's position, weapon, and shooter."
              checked={!opts.skipWeaponFires}
              onChange={(v) => update({ skipWeaponFires: !v })}
            />

            <div className="flex justify-end border-t border-white/[0.06] pt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOpts(DEFAULT_PARSE_OPTIONS);
                  saveParseOptions(DEFAULT_PARSE_OPTIONS);
                }}
              >
                Reset to defaults
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-neutral-200">{label}</div>
      {children}
      {hint && <p className="text-[10.5px] leading-snug text-neutral-500">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-neutral-200">{label}</div>
        {hint && (
          <p className="mt-0.5 text-[10.5px] leading-snug text-neutral-500">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked
            ? "border-emerald-300/40 bg-emerald-300/30"
            : "border-white/[0.08] bg-black/40",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 size-3.5 rounded-full transition-all",
            checked ? "left-[18px] bg-emerald-200" : "left-0.5 bg-neutral-400",
          ].join(" ")}
        />
      </button>
    </label>
  );
}
