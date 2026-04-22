"use client";

import type { ReactNode } from "react";
import { useReplay } from "@/lib/replay-store";
import { cn } from "@/lib/utils";
import type { Frame, PlayerPos } from "@/lib/types";
import { Crosshair } from "lucide-react";

function sample(frames: Frame[], t: number): PlayerPos[] {
  if (!frames || frames.length === 0) return [];
  if (t <= frames[0].t) return frames[0].players;
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1].players;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return frames[lo].players;
}

export function PlayerHUD() {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const time = useReplay((s) => s.time) ?? 0;
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;

  const positions = sample(round.frames, time);
  const byId = new Map(positions.map((p) => [p.id, p]));

  const ct = match.players.filter((p) => p.team === "CT");
  const t = match.players.filter((p) => p.team === "T");

  return (
    <aside className="w-64 shrink-0 border-l border-white/[0.07] bg-[#080b0a]/95 px-2 py-3">
      <Section title="Counter-Terrorists" accent="sky" players={ct} byId={byId} />
      <Section title="Terrorists" accent="amber" players={t} byId={byId} />
    </aside>
  );
}

function itemCode(name?: string) {
  if (!name) return "";
  const normalized = name.toLowerCase();
  if (normalized.includes("flash")) return "F";
  if (normalized.includes("smoke")) return "S";
  if (normalized.includes("molotov")) return "M";
  if (normalized.includes("incendiary")) return "I";
  if (normalized.includes("explosive") || normalized.includes("he grenade")) return "H";
  if (normalized.includes("decoy")) return "D";
  if (normalized.includes("knife")) return "K";
  if (normalized.includes("bomb") || normalized.includes("c4")) return "C4";
  if (normalized.includes("awp")) return "AWP";
  if (normalized.includes("ak")) return "AK";
  if (normalized.includes("m4")) return "M4";
  if (normalized.includes("galil")) return "GAL";
  if (normalized.includes("famas")) return "FAM";
  if (normalized.includes("deagle") || normalized.includes("desert eagle")) return "DE";
  if (normalized.includes("usp")) return "USP";
  if (normalized.includes("glock")) return "GLK";
  if (normalized.includes("p250")) return "P250";
  return name.slice(0, 3).toUpperCase();
}

function isUtility(name: string) {
  return /grenade|flashbang|molotov|incendiary|decoy/i.test(name);
}

function inventory(pos?: PlayerPos) {
  const weapons = pos?.weapons ?? [];
  const active = pos?.active ?? weapons.find((w) => !isUtility(w) && w !== "Knife" && w !== "C4") ?? "";
  const utility = weapons.filter(isUtility);
  const guns = weapons.filter((w) => !isUtility(w) && w !== "Knife" && w !== "C4" && w !== active);
  return { active, guns, utility };
}

function displayName(name: string) {
  return name === "L999" ? "grosNoob" : name;
}

function Section({
  title,
  accent,
  players,
  byId,
}: {
  title: string;
  accent: "sky" | "amber";
  players: { steamId: number; name: string }[];
  byId: Map<number, PlayerPos>;
}) {
  return (
    <div className="mb-3">
      <div
        className={cn(
          "mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.22em]",
          accent === "sky" ? "text-sky-300" : "text-amber-300"
        )}
      >
        {title}
      </div>
      <div className="space-y-1">
        {players.map((p) => {
          const pos = byId.get(p.steamId);
          const hp = pos?.hp ?? 0;
          const armor = pos?.armor ?? 0;
          const alive = hp > 0;
          const inv = inventory(pos);
          return (
            <div
              key={p.steamId}
              className={cn(
                "rounded-lg border border-white/[0.05] bg-white/[0.025] px-2 py-1.5 transition-colors",
                pos?.hasBomb && "border-red-400/45 bg-red-500/[0.08]",
                !alive && "opacity-40"
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs font-medium text-neutral-200",
                    pos?.hasBomb && "text-red-300",
                    !alive && "line-through"
                  )}
                >
                  {displayName(p.name)}
                </span>
                <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-neutral-500">
                  {hp}
                </span>
              </div>

              <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-black/35">
                <div
                  className={cn(
                    "h-full transition-all",
                    accent === "sky" ? "bg-sky-300" : "bg-amber-300"
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, hp))}%` }}
                />
              </div>

              <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
                <ArmorChip armor={armor} helmet={Boolean(pos?.helmet)} />
                {pos?.kit && (
                  <IconChip active title="Defuse kit" className="text-sky-200">
                    KIT
                  </IconChip>
                )}

                {inv.active && (
                  <IconChip active title={inv.active}>
                    <Crosshair className="size-3" />
                    {itemCode(inv.active)}
                  </IconChip>
                )}

                {inv.utility.slice(0, 4).map((u, idx) => (
                  <IconChip key={`${u}-${idx}`} active title={u} className="text-emerald-200">
                    {itemCode(u)}
                  </IconChip>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArmorChip({ armor, helmet }: { armor: number; helmet: boolean }) {
  const active = armor > 0 || helmet;
  return (
    <IconChip
      active={active}
      title={helmet ? `Kevlar + helmet ${armor}` : armor > 0 ? `Kevlar ${armor}` : "No armor"}
      className={cn(
        "w-8 px-0",
        helmet
          ? "border-emerald-300/25 bg-emerald-300/[0.09] text-emerald-100"
          : armor > 0 && "text-neutral-200"
      )}
    >
      <span className="relative inline-flex size-4 items-center justify-center">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={cn("size-4", !active && "opacity-35")}
        >
          <path
            d="M8 1.8 13 3.6v4.2c0 3.1-1.9 5.4-5 6.4-3.1-1-5-3.3-5-6.4V3.6L8 1.8Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          {helmet && (
            <path
              d="M4.7 8.4a3.3 3.3 0 0 1 6.6 0h-1.2a2.1 2.1 0 0 0-4.2 0H4.7Z"
              fill="currentColor"
            />
          )}
        </svg>
      </span>
    </IconChip>
  );
}

function IconChip({
  active,
  title,
  className,
  children,
}: {
  active: boolean;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center justify-center gap-0.5 rounded border px-1 text-[9px] font-semibold leading-none",
        active
          ? "border-white/10 bg-white/[0.045] text-neutral-200"
          : "border-white/[0.05] text-neutral-700",
        className
      )}
    >
      {children}
    </span>
  );
}
