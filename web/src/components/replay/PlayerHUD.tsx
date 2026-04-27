"use client";

import { useReplay } from "@/lib/replay-store";
import { cn } from "@/lib/utils";
import type { Frame, PlayerPos } from "@/lib/types";
import { iconPathFor } from "@/lib/icons";
import { THEME, sideColors } from "@/lib/theme";

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

export function PlayerHUD({ side }: { side: "CT" | "T" }) {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const time = useReplay((s) => s.time) ?? 0;
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;

  const positions = sample(round.frames, time);
  const byId = new Map(positions.map((p) => [p.id, p]));
  const teamCode = side === "CT" ? 3 : 2;

  // Determine each player's team for THIS round by majority vote across
  // every frame in the round. match.players.team is set at first sighting
  // (often during warmup) and lies after side-switch / half-time, which
  // would otherwise put the same player in both HUDs.
  const teamVotes = new Map<number, { ct: number; t: number }>();
  for (const frame of round.frames) {
    for (const pos of frame.players) {
      let v = teamVotes.get(pos.id);
      if (!v) {
        v = { ct: 0, t: 0 };
        teamVotes.set(pos.id, v);
      }
      if (pos.team === 3) v.ct++;
      else if (pos.team === 2) v.t++;
    }
  }
  const roundTeam = (id: number): number | null => {
    const v = teamVotes.get(id);
    if (!v) return null;
    if (v.ct === 0 && v.t === 0) return null;
    return v.ct >= v.t ? 3 : 2;
  };

  // Roster is anchored to the round-wide team assignment, so dead players
  // keep their slot and the order doesn't reshuffle as the round plays.
  const sidePlayers: { steamId: number; name: string }[] = [];
  for (const id of teamVotes.keys()) {
    if (roundTeam(id) !== teamCode) continue;
    const info = match.players.find((p) => p.steamId === id);
    sidePlayers.push({ steamId: id, name: info?.name ?? "" });
  }
  sidePlayers.sort((a, b) =>
    a.steamId === b.steamId ? 0 : a.steamId < b.steamId ? -1 : 1,
  );
  const players = sidePlayers.slice(0, 5);
  const teamName = side === "CT" ? match.meta.teamA : match.meta.teamB;
  const teamScore = side === "CT" ? round.scoreA ?? 0 : round.scoreB ?? 0;

  return (
    <aside
      className={cn(
        "pointer-events-none absolute top-1/2 z-20 flex w-[250px] -translate-y-[48%] flex-col gap-1",
        side === "CT" ? "left-5" : "right-5"
      )}
    >
      <div
        className="mb-2 flex items-center gap-2"
      >
        <div
          className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
          style={{
            background: side === "CT" ? "#8f2930" : "#93862f",
            borderColor: side === "CT" ? "#ff8a8f" : "#d4c664",
            color: "#fff",
          }}
        >
          {(teamName || side).slice(0, 1).toUpperCase()}
        </div>
        <span
          className="flex-1 truncate text-[13px] font-bold uppercase tracking-wide"
          style={{
            color: THEME.textBright,
            textAlign: "left",
          }}
        >
          {teamName || side}
        </span>
        <span
          className="shrink-0 font-mono text-[15px] font-bold tabular-nums"
          style={{ color: THEME.textBright }}
        >
          {teamScore}
        </span>
      </div>

      {players.map((p) => {
        const pos = byId.get(p.steamId);
        const name = p.name || `#${String(p.steamId).slice(-4)}`;
        return <PlayerRow key={p.steamId} name={name} pos={pos} side={side} />;
      })}
    </aside>
  );
}

function displayName(name: string) {
  return name === "L999" ? "grosNoob" : name;
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
  const active = pos?.active ?? "";
  const utility = weapons.filter(isUtility).slice().sort((a, b) => utilityRank(a) - utilityRank(b));
  const guns = weapons
    .filter((w) => !isUtility(w) && w !== "Knife" && w !== "C4")
    .slice()
    .sort((a, b) => gunRank(a) - gunRank(b));
  const hasKnife = weapons.some((w) => w === "Knife" || /knife|bayonet|karambit/i.test(w));
  const hasC4 = weapons.some((w) => w === "C4" || /bomb/i.test(w));
  const primary = guns[0];
  return { active, guns, utility, hasKnife, hasC4, primary };
}

function PlayerRow({
  name,
  pos,
  side,
}: {
  name: string;
  pos?: PlayerPos;
  side: "CT" | "T";
}) {
  const hp = pos?.hp ?? 0;
  const alive = hp > 0;
  const armor = pos?.armor ?? 0;
  const money = pos?.money ?? 0;
  const inv = inventory(pos);
  const cols = sideColors(side);

  const hpPct = Math.max(0, Math.min(100, hp));

  return (
    <div className="pointer-events-auto flex flex-col gap-0.5">
      <div
        className="relative flex h-[24px] w-full items-center overflow-hidden rounded-[2px] bg-[#232424]/90 px-2"
      >
        {/* HP fill in team color */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-150 ease-out"
          style={{
            width: `${hpPct}%`,
            background: alive ? cols.bg : "transparent",
          }}
        />
        <span
          className="relative flex-1 truncate text-[12px] font-semibold"
          style={{
            color: alive ? "#fff" : THEME.textDead,
            textDecoration: !alive ? "line-through" : undefined,
            textAlign: "left",
          }}
        >
          {displayName(name)}
        </span>
        <span
          className="relative shrink-0 px-1 font-mono text-[11px] font-semibold tabular-nums"
          style={{ color: alive ? "#fff" : THEME.textDead }}
        >
          ${money}
        </span>
      </div>

      <div
        className="flex h-[18px] w-full items-center gap-1.5 px-0.5"
      >
        <Icon
          src={armor > 0 && pos?.helmet ? "/icons/armor_helmet.svg" : "/icons/kevlar.svg"}
          active={alive && armor > 0}
          color={armor > 0 ? "#8f9696" : THEME.textDead}
          size="gear"
        />
        {inv.primary && (
          <Icon
            src={iconPathFor(inv.primary)}
            active={alive}
            color={inv.primary === inv.active ? "#91e268" : "#d6dddd"}
            size="weapon"
          />
        )}
        {inv.hasC4 && <Icon src="/icons/c4.svg" active color="#fde047" size="gear" />}
        {pos?.kit && <Icon src="/icons/defuser.svg" active color={cols.soft} size="gear" />}
        <div className="flex-1" />
        {inv.utility.map((u, i) => (
          <Icon
            key={`u-${i}`}
            src={iconPathFor(u)}
            active={alive}
            color={u === inv.active ? "#91e268" : "#8f9696"}
            size="utility"
          />
        ))}
        {inv.hasKnife && (
          <Icon
            src="/icons/knife.svg"
            active={alive}
            color={inv.active === "Knife" ? "#91e268" : "#8f9696"}
            size="utility"
          />
        )}
      </div>
    </div>
  );
}

function Icon({
  src,
  active,
  color,
  size = "gear",
}: {
  src: string | null;
  active: boolean;
  color: string;
  size?: "gear" | "weapon" | "utility";
}) {
  if (!src) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0",
        size === "weapon" && "h-[15px] w-[34px]",
        size === "gear" && "size-[14px]",
        size === "utility" && "size-[11px]"
      )}
      style={{
        backgroundColor: active ? color : THEME.textDead,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        opacity: active ? 1 : 0.4,
      }}
    />
  );
}
