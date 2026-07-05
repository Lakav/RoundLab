"use client";

import { useId, useState } from "react";
import { Settings, X } from "lucide-react";

/** Renders a small gear button. Parsing is intentionally locked to full capture
 *  until lower-fidelity modes are proven not to break replay review. */
export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        aria-controls={panelId}
        aria-expanded={open}
        className="flex size-8 items-center justify-center rounded-md border border-white/[0.06] bg-black/30 text-neutral-400 transition-colors hover:border-white/[0.12] hover:text-neutral-100"
      >
        <Settings className="size-4" />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          className="absolute right-0 top-10 z-20 w-[360px] rounded-xl border border-white/[0.08] bg-[#121414] p-4 shadow-2xl shadow-black/60"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 id={titleId} className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
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
              label="Capture fidelity"
              hint="Locked to every tick. Projectiles, shots, bomb state, player state and parsed events are kept whenever the parser exposes them."
            >
              <div className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-xs font-medium text-emerald-100">
                Full tick capture
              </div>
            </Field>
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
