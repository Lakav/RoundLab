"use client";

import { useReplay } from "@/lib/replay-store";
import { cn } from "@/lib/utils";
import type { Frame, PlayerPos } from "@/lib/types";
import { iconPathFor } from "@/lib/icons";

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

  const teamA = match.players.filter((p) => p.team === "CT");
  const teamB = match.players.filter((p) => p.team === "T");

  const firstA = teamA[0] ? byId.get(teamA[0].steamId) : undefined;
  const accentA: "sky" | "amber" = firstA?.team === 2 ? "amber" : "sky";
  const accentB: "sky" | "amber" = accentA === "sky" ? "amber" : "sky";

  return (
    <aside className="flex h-full w-48 shrink-0 flex-col gap-1 border-l border-white/[0.07] bg-[#080b0a]/95 px-1.5 py-1.5">
      <Section title={match.meta.teamA || "Team A"} accent={accentA} players={teamA} byId={byId} />
      <Section title={match.meta.teamB || "Team B"} accent={accentB} players={teamB} byId={byId} />
    </aside>
  );
}

function isUtility(name: string) {
  return /grenade|flashbang|molotov|incendiary|decoy/i.test(name);
}

const UTILITY_ORDER = ["flash", "smoke", "he", "molotov", "incendiary", "decoy"];
function utilityRank(name: string) {
  const n = name.toLowerCase();
  for (let i = 0; i < UTILITY_ORDER.length; i++) {
    if (n.includes(UTILITY_ORDER[i])) return i;
  }
  return UTILITY_ORDER.length;
}

const GUN_ORDER = ["awp", "ssg", "scar", "g3sg", "aug", "sg ", "ak", "m4", "famas", "galil", "p90", "mp", "ump", "bizon", "mac", "nova", "xm", "sawed", "mag", "m249", "negev", "deagle", "revolver", "usp", "glock", "p2000", "hkp2000", "p250", "five", "cz", "tec", "elite", "dual", "zeus", "taser"];
function gunRank(name: string) {
  const n = name.toLowerCase();
  for (let i = 0; i < GUN_ORDER.length; i++) {
    if (n.includes(GUN_ORDER[i])) return i;
  }
  return GUN_ORDER.length;
}

function inventory(pos?: PlayerPos) {
  const weapons = pos?.weapons ?? [];
  const active = pos?.active ?? weapons.find((w) => !isUtility(w) && w !== "Knife" && w !== "C4") ?? "";
  const utility = weapons.filter(isUtility).slice().sort((a, b) => utilityRank(a) - utilityRank(b));
  const guns = weapons
    .filter((w) => !isUtility(w) && w !== "Knife" && w !== "C4")
    .slice()
    .sort((a, b) => gunRank(a) - gunRank(b));
  const hasKnife = weapons.some((w) => w === "Knife" || /knife|bayonet|karambit/i.test(w));
  const hasC4 = weapons.some((w) => w === "C4" || /bomb/i.test(w));
  return { active, guns, utility, hasKnife, hasC4 };
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "mb-1 shrink-0 truncate px-1 text-[11px] font-semibold",
          accent === "sky" ? "text-sky-300" : "text-amber-300"
        )}
      >
        {title}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-5 gap-0.5 overflow-hidden">
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
                "min-h-0 overflow-hidden rounded border border-white/[0.05] bg-white/[0.025] px-1.5 py-1 transition-colors",
                pos?.hasBomb && "border-red-400/45 bg-red-500/[0.08]",
                !alive && "opacity-40"
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-200",
                    pos?.hasBomb && "text-red-300",
                    !alive && "line-through"
                  )}
                >
                  {displayName(p.name)}
                </span>
                <span className="w-5 shrink-0 text-right font-mono text-[10px] tabular-nums text-neutral-500">
                  {hp}
                </span>
              </div>

              <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-black/35">
                <div
                  className={cn(
                    "h-full transition-all",
                    accent === "sky" ? "bg-sky-300" : "bg-amber-300"
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, hp))}%` }}
                />
              </div>
              <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-black/35">
                <div
                  className={cn(
                    "h-full transition-all",
                    pos?.helmet ? "bg-emerald-300" : "bg-neutral-300"
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, armor))}%` }}
                />
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-0.5 overflow-hidden">
                <ArmorChip armor={armor} helmet={Boolean(pos?.helmet)} />
                {pos?.kit && (
                  <SvgChip active title="Defuse kit" src="/icons/defuser.svg" />
                )}

                {inv.guns.map((w, idx) => {
                  const isActive = w === inv.active;
                  return (
                    <SvgChip
                      key={`gun-${w}-${idx}`}
                      active
                      title={w}
                      src={iconPathFor(w)}
                      wide
                      className={cn(
                        isActive && "border-emerald-300/30 bg-emerald-300/[0.1] text-emerald-200"
                      )}
                    />
                  );
                })}

                {inv.hasKnife && (
                  <SvgChip
                    active
                    title="Knife"
                    src="/icons/knife.svg"
                    className={cn(
                      inv.active === "Knife" && "border-emerald-300/30 bg-emerald-300/[0.1] text-emerald-200"
                    )}
                  />
                )}

                {inv.hasC4 && (
                  <SvgChip
                    active
                    title="C4"
                    src="/icons/c4.svg"
                    className={cn(
                      (inv.active === "C4" || pos?.hasBomb) && "border-emerald-300/30 bg-emerald-300/[0.1] text-emerald-200"
                    )}
                  />
                )}
              </div>

              {inv.utility.length > 0 && (
                <div className="mt-0.5 flex flex-wrap items-center gap-0.5 overflow-hidden">
                  {inv.utility.map((u, idx) => (
                    <SvgChip
                      key={`util-${u}-${idx}`}
                      active
                      title={u}
                      src={iconPathFor(u)}
                      className={cn(
                        u === inv.active && "border-emerald-300/30 bg-emerald-300/[0.1] text-emerald-200"
                      )}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ArmorChip({ armor, helmet }: { armor: number; helmet: boolean }) {
  const active = armor > 0 || helmet;
  const src = helmet ? "/icons/armor_helmet.svg" : "/icons/kevlar.svg";
  return (
    <SvgChip
      active={active}
      title={helmet ? `Kevlar + helmet ${armor}` : armor > 0 ? `Kevlar ${armor}` : "No armor"}
      src={src}
    />
  );
}

function SvgChip({
  active,
  title,
  src,
  wide,
  className,
}: {
  active: boolean;
  title: string;
  src: string | null;
  wide?: boolean;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-4 shrink-0 items-center justify-center rounded border",
        wide ? "px-1" : "w-5 px-0",
        active
          ? "border-white/10 bg-white/[0.045] text-neutral-200"
          : "border-white/[0.05] text-neutral-700",
        className
      )}
    >
      {src ? (
        <span
          aria-hidden="true"
          className={cn(wide ? "h-3 w-7" : "size-3", !active && "opacity-35")}
          style={{
            backgroundColor: "currentColor",
            WebkitMaskImage: `url(${src})`,
            maskImage: `url(${src})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskSize: "contain",
            maskSize: "contain",
          }}
        />
      ) : (
        <span className="text-[9px] font-semibold leading-none">?</span>
      )}
    </span>
  );
}

