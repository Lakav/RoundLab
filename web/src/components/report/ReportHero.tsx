import type { MatchAnalysis } from "@/lib/analysis/types";
import type { SpatialAnalysis } from "@/lib/analysis/spatial-types";
import { DefinitionTerm } from "@/components/ui/definition-term";
import { teamLabel } from "./report-formatters";

export type ReportCoverageEntry = {
  key: string;
  label: string;
  /** Players for whom this family of metrics could be computed. */
  available: number;
};

export function ReportHero({
  analysis,
  spatial,
  coverage,
}: {
  analysis: MatchAnalysis;
  spatial: SpatialAnalysis | null;
  coverage: ReadonlyArray<ReportCoverageEntry>;
}) {
  const totalPlayers = analysis.players.length;
  const availableFamilies = coverage.filter((entry) => entry.available > 0);
  const partialFamilies = availableFamilies.filter((entry) => entry.available < totalPlayers);
  const missingFamilies = coverage.filter((entry) => entry.available === 0);
  const coverageTone = missingFamilies.length === 0 && partialFamilies.length === 0
    ? "complete"
    : missingFamilies.length >= coverage.length / 2
      ? "sparse"
      : "partial";
  const displayedTeams = analysis.teams.slice(0, 2);
  const completeScore = displayedTeams.every((team) => team.score !== null)
    && displayedTeams.reduce((total, team) => total + (team.score ?? 0), 0)
      === analysis.rounds.length;
  const reportMapAsset = spatial?.map && /^de_[a-z0-9_]+$/.test(spatial.map)
    ? `/cs2lens-maps/${spatial.map}.png`
    : null;
  const highestScore = Math.max(...displayedTeams.map((team) => team.score ?? -1));

  return (
    <header className="report-hero relative min-h-[11rem] overflow-hidden rounded-xl border border-[var(--rl-border)] bg-[#121515] px-5 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] sm:px-8 sm:py-7">
      {reportMapAsset && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[length:40rem] bg-[position:88%_46%] bg-no-repeat opacity-[0.34]"
          style={{ backgroundImage: `url("${reportMapAsset}")` }}
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#111514_0%,rgba(17,21,20,0.9)_38%,rgba(17,21,20,0.55)_70%,rgba(17,21,20,0.78)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-200/20 to-transparent" />
      <div className="relative grid min-h-[7.5rem] gap-7 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--rl-fg-dim)]">
              {spatial?.map ? spatial.map.replace(/^de_/, "").toUpperCase() : "Rapport de match"}
            </span>
          </div>
          <h1 className="mt-3 text-[1.75rem] font-semibold tracking-[-0.035em] text-white sm:text-3xl">
            Rapport du match
          </h1>
          <p className="mt-2 text-xs text-[var(--rl-fg-dim)]">
            {analysis.rounds.length} round{analysis.rounds.length > 1 ? "s" : ""} ·{" "}
            {analysis.players.length} joueurs analysés
          </p>
        </div>
        <div className="flex items-center justify-start gap-5 rounded-xl border border-white/[0.07] bg-black/20 px-6 py-4 backdrop-blur-sm md:justify-center">
          {displayedTeams.map((team, index) => (
            <div key={team.logicalTeam} className="contents">
              {index > 0 && <span className="text-xl font-light text-[var(--rl-fg-dim)]">:</span>}
              <div className={index === 1 ? "text-right" : undefined}>
                <div className={[
                  "text-5xl font-semibold leading-none tracking-[-0.06em] tabular-nums",
                  (team.score ?? -1) === highestScore ? "text-[var(--rl-positive)]" : "text-[var(--rl-fg)]",
                ].join(" ")}>
                  {team.score ?? "—"}
                </div>
                <div className="mt-2 max-w-36 truncate text-[13px] font-semibold text-[var(--rl-fg-muted)]">
                  <span
                    className={[
                      "mr-1.5 inline-block size-1.5 rounded-full align-middle",
                      index === 0 ? "bg-[var(--rl-ct)]" : "bg-[var(--rl-t)]",
                    ].join(" ")}
                  />
                  {teamLabel(team.name)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden max-w-[17rem] justify-self-end text-right md:block">
          <div className="flex items-center justify-end gap-2 text-sm font-semibold text-[var(--rl-fg)]">
            <span
              aria-hidden="true"
              className={[
                "size-1.5 rounded-full",
                coverageTone === "complete"
                  ? "bg-[var(--rl-positive)]"
                  : coverageTone === "partial"
                    ? "bg-[var(--rl-warning)]"
                    : "bg-[var(--rl-critical)]",
              ].join(" ")}
            />
            <span className="tabular-nums">
              <DefinitionTerm
                label={`${availableFamilies.length}/${coverage.length} familles de données`}
                definition={
                  missingFamilies.length === 0 && partialFamilies.length === 0
                    ? "Toutes les métriques sont calculables pour chaque joueur."
                    : [
                      missingFamilies.length > 0
                        ? `Absent de cette démo : ${missingFamilies.map((entry) => entry.label.toLowerCase()).join(", ")}.`
                        : "",
                      partialFamilies.length > 0
                        ? `Partiel : ${partialFamilies.map((entry) => entry.label.toLowerCase()).join(", ")}.`
                        : "",
                    ].filter(Boolean).join(" ")
                }
              />
            </span>
          </div>
          <div className="mt-1.5 text-xs text-[var(--rl-fg-dim)]">
            {completeScore
              ? "Score complet"
              : displayedTeams.every((team) => team.score !== null)
                ? "Score observé"
                : "Score incomplet"}
          </div>
        </div>
      </div>
    </header>
  );
}
