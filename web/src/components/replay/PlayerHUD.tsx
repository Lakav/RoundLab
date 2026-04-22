"use client";

import { useReplay } from "@/lib/replay-store";
import { cn } from "@/lib/utils";
import type { Frame, PlayerPos } from "@/lib/types";
import { Crosshair, Shield } from "lucide-react";

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
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-white/5 bg-neutral-950">
      <Section title="Counter-Terrorists" accent="sky" players={ct} byId={byId} />
      <Section title="Terrorists" accent="amber" players={t} byId={byId} />
    </aside>
  );
}

function weaponLabel(name?: string) {
  if (!name) return "";
  return name
    .replace("Incendiary Grenade", "Inc")
    .replace("High Explosive Grenade", "HE")
    .replace("HE Grenade", "HE")
    .replace("Smoke Grenade", "Smoke")
    .replace("Flashbang", "Flash")
    .replace("Molotov", "Molo")
    .replace("Desert Eagle", "Deagle")
    .replace("Silenced M4A1", "M4A1-S")
    .replace("USP-S", "USP");
}

function isUtility(name: string) {
  return /grenade|flashbang|molotov|incendiary|decoy/i.test(name);
}

function inventory(pos?: PlayerPos) {
  const weapons = pos?.weapons ?? [];
  const active = pos?.active ?? weapons.find((w) => !isUtility(w) && w !== "Knife") ?? "";
  const utility = weapons.filter(isUtility);
  const guns = weapons.filter((w) => !isUtility(w) && w !== "Knife" && w !== active);
  return { active, guns, utility };
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
    <div className="px-3 py-4 border-b border-white/5">
      <div
        className={cn(
          "text-[10px] uppercase tracking-widest font-semibold mb-3",
          accent === "sky" ? "text-sky-400" : "text-amber-400"
        )}
      >
        {title}
      </div>
      <div className="space-y-1.5">
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
                "rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-2",
                !alive && "opacity-40"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-sm font-medium truncate",
                    !alive && "line-through"
                  )}
                >
                  {p.name}
                </span>
                <span className="text-xs tabular-nums text-neutral-400 ml-2">
                  {hp}
                </span>
              </div>

              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className={cn(
                    "h-full transition-all",
                    accent === "sky" ? "bg-sky-500" : "bg-amber-500"
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, hp))}%` }}
                />
              </div>

              <div className="mt-2 flex items-center gap-1.5 text-[10px] text-neutral-400">
                <span
                  className={cn(
                    "inline-flex h-5 min-w-9 items-center justify-center gap-1 rounded border px-1.5 tabular-nums",
                    armor > 0
                      ? "border-white/10 bg-white/[0.04] text-neutral-200"
                      : "border-white/5 text-neutral-600"
                  )}
                  title="Kevlar"
                >
                  <Shield className="size-3" />
                  {armor}
                </span>
                <span
                  className={cn(
                    "inline-flex h-5 w-6 items-center justify-center rounded border text-[10px] font-semibold",
                    pos?.helmet
                      ? "border-white/10 bg-white/[0.04] text-neutral-100"
                      : "border-white/5 text-neutral-600"
                  )}
                  title="Helmet"
                >
                  H
                </span>
                {pos?.kit && (
                  <span
                    className="inline-flex h-5 items-center rounded border border-sky-400/20 bg-sky-400/10 px-1.5 text-[10px] font-semibold text-sky-300"
                    title="Defuse kit"
                  >
                    KIT
                  </span>
                )}
              </div>

              {(inv.active || inv.guns.length > 0 || inv.utility.length > 0) && (
                <div className="mt-2 space-y-1.5">
                  {inv.active && (
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-200">
                      <Crosshair className="size-3 shrink-0 text-neutral-500" />
                      <span className="truncate font-medium">
                        {weaponLabel(inv.active)}
                      </span>
                    </div>
                  )}

                  {inv.guns.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {inv.guns.slice(0, 3).map((w, idx) => (
                        <span
                          key={`${w}-${idx}`}
                          className="rounded border border-white/5 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-neutral-400"
                        >
                          {weaponLabel(w)}
                        </span>
                      ))}
                    </div>
                  )}

                  {inv.utility.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {inv.utility.map((u, idx) => (
                        <span
                          key={`${u}-${idx}`}
                          className="rounded border border-emerald-400/15 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300"
                        >
                          {weaponLabel(u)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
