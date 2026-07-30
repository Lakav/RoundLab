/* eslint-disable @next/next/no-img-element */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useReplay } from "@/lib/replay-store";
import { replayMatch, replayRound } from "./fixtures";

const mocks = vi.hoisted(() => ({
  enterMatchFullscreen: vi.fn(),
  exitMatchFullscreen: vi.fn(),
  getMatchMetadata: vi.fn(),
  getRound: vi.fn(),
  writeDebugLog: vi.fn(),
}));

vi.mock("next/image", () => ({ default: ({ alt = "", ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} {...props} /> }));
vi.mock("@/components/replay/MapRenderer", () => ({
  MapRenderer: ({
    descriptionId,
    size,
  }: {
    descriptionId?: string;
    size?: number;
  }) => (
    <div
      role="img"
      aria-label="Interactive replay radar"
      aria-describedby={descriptionId}
      style={{ width: size, height: size }}
    />
  ),
}));
vi.mock("@/components/replay/DrawingLayer", () => ({ DrawingLayer: () => <canvas />, }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    enterMatchFullscreen: mocks.enterMatchFullscreen,
    exitMatchFullscreen: mocks.exitMatchFullscreen,
    getMatchMetadata: mocks.getMatchMetadata,
    getRound: mocks.getRound,
    writeDebugLog: mocks.writeDebugLog,
  };
});

import MatchViewer from "@/app/match/MatchViewer";

class ResizeObserverDouble {
  observe() {}
  disconnect() {}
}

describe("MatchViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverDouble);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    mocks.enterMatchFullscreen.mockResolvedValue(undefined);
    mocks.exitMatchFullscreen.mockResolvedValue(undefined);
    mocks.writeDebugLog.mockResolvedValue(undefined);
    const loaded = replayRound(1, 12);
    loaded.freezeEndTick = 0;
    loaded.frames[0].players[0].equipmentValue = 1_500;
    loaded.frames[0].players.push({
      id: 2,
      x: 30,
      y: 40,
      z: 10,
      yaw: 180,
      hp: 90,
      armor: 50,
      team: 3,
      equipmentValue: 3_500,
    });
    loaded.frames[0].players.push({
      id: 3,
      x: 15,
      y: 25,
      z: 30,
      yaw: 90,
      hp: 100,
      armor: 100,
      team: 2,
      equipmentValue: 1_500,
    });
    loaded.frames[0].players.push({
      id: 4,
      x: 35,
      y: 45,
      z: 10,
      yaw: 180,
      hp: 100,
      armor: 100,
      team: 3,
      equipmentValue: 3_500,
    });
    loaded.events = [
      {
        t: 0.5,
        tick: 32,
        sequence: 1,
        type: "kill",
        killer: 1,
        victim: 4,
        assist: 3,
        flashAssist: true,
        weapon: "ak47",
        hs: true,
      },
      { t: 1, tick: 64, sequence: 2, type: "kill", killer: 2, victim: 3, weapon: "m4a1" },
      { t: 2, tick: 128, sequence: 3, type: "kill", killer: 1, victim: 2, weapon: "ak47" },
    ];
    loaded.weaponFires = [{
      t: 0.25,
      tick: 16,
      sequence: 0,
      shooter: 1,
      weapon: "flashbang",
      x: 10,
      y: 20,
      z: 30,
      yaw: 90,
    }];
    const metadata = replayMatch([{ ...loaded, frames: [], events: [] }]);
    metadata.players.push({ steamId: 2, name: "Player Two", team: "CT" });
    metadata.players.push({ steamId: 3, name: "Player Three", team: "T" });
    metadata.players.push({ steamId: 4, name: "Player Four", team: "CT" });
    mocks.getMatchMetadata.mockResolvedValue(metadata);
    mocks.getRound.mockResolvedValue(loaded);
  });

  it("loads round data and exposes the replay text alternative", async () => {
    render(<MatchViewer id="match-a" />);
    expect(await screen.findByRole("heading", { level: 1, name: "RoundLab match replay" })).toBeInTheDocument();
    await waitFor(() => expect(mocks.getRound).toHaveBeenCalledWith("match-a", 1, false));
    expect(screen.getByRole("img", { name: "Interactive replay radar" })).toHaveAttribute("aria-describedby", "replay-text-alternative");
    expect(screen.getByRole("region", { name: "Text alternative for the replay radar" })).toHaveTextContent("Player One");
  });

  it("supports keyboard playback, zoom and trajectory mode", async () => {
    const user = userEvent.setup();
    render(<MatchViewer id="match-a" />);
    await screen.findByRole("heading", { level: 1, name: "RoundLab match replay" });
    await waitFor(() => expect(screen.getByTitle("Play/Pause (Space)")).toBeEnabled());
    expect(screen.getByTestId("match-map-viewport")).toHaveClass("overflow-hidden");
    expect(screen.getByTestId("match-map-clip")).toHaveStyle({ overflow: "hidden" });
    fireEvent.keyDown(window, { code: "Space" });
    expect(screen.getByTitle("Play/Pause (Space)")).toBeEnabled();
    await user.click(screen.getByTitle("Zoom in"));
    expect(screen.getByText("125%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Trajectoires" }));
    expect(screen.getByRole("combobox")).toHaveValue("player:1");
  });

  it("builds the V1 report on demand and exposes player evidence", async () => {
    const user = userEvent.setup();
    render(<MatchViewer id="match-report" />);
    await screen.findByRole("heading", { level: 1, name: "RoundLab match replay" });
    await waitFor(() => expect(mocks.getRound).toHaveBeenCalledWith("match-report", 1, false));

    await user.click(screen.getByRole("button", { name: "Rapport" }));

    expect(await screen.findByRole("heading", { name: "Rapport du match" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Sections du rapport" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Joueurs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Général" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Aim" }));
    expect(screen.getByRole("columnheader", { name: "Tirs" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Arrêt avant tir" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Joueurs" }));
    expect(screen.getByRole("navigation", { name: "Analyses des joueurs" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Général" }));
    expect(screen.queryByRole("columnheader", { name: "HLTV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Performance" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rounds" }));
    expect(screen.getByRole("heading", { name: "Round 1" })).toBeInTheDocument();
    expect(screen.getByText("Joueurs du round")).toBeInTheDocument();
    expect(screen.queryByText("Moments du round")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Joueurs" }));
    await user.click(screen.getByRole("button", { name: "Aim" }));
    expect(screen.getByRole("heading", { name: "Aim" })).toBeInTheDocument();
    expect(screen.getByText("Données brutes de tir")).toBeInTheDocument();
    expect(screen.getByText("Afficher")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Métriques avancées" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Dégâts / impact" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tap" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Burst" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Spray" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tirs ennemi repéré" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Accuracy all" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Arrêt avant tir" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Actions de combat" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Panneau Review" }))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rapport" }));
    await user.click(screen.getByRole("button", { name: "Joueurs" }));
    await user.click(screen.getByRole("button", { name: "Utilitaires" }));

    expect(screen.getByRole("heading", { name: "Utilitaires" })).toBeInTheDocument();
    expect(screen.getByText("Usage par joueur")).toBeInTheDocument();
    expect(screen.getByText("Répartition par équipe")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Grenade lancée, Player One, round 1, ouvrir dans le replay",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Flash assist, Player Three, round 1, ouvrir dans le replay",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Trades" }));
    expect(screen.getByRole("heading", { name: "Trades" })).toBeInTheDocument();
    expect(screen.getByText("Bilan par joueur")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Réussite des trades" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Trade kill, Player One, round 1, ouvrir dans le replay",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Mort tradée, Player Three, round 1, ouvrir dans le replay",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Activité" }));
    expect(screen.getByRole("columnheader", { name: "Dégâts HE" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Survie" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Armes" }));
    expect(screen.getByRole("heading", { name: "Statistiques par arme" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Joueur" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Équipe" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Côté" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Round" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Opening duels" }));
    expect(screen.getByText("Détail par round")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tentatives d'opening" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Openings tous côtés" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Openings côté T" }));
    expect(screen.getByRole("button", { name: "Openings côté T" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("columnheader", { name: "Côté" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("columnheader", { name: "Arme" }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Clutches" }));
    expect(screen.getByRole("columnheader", { name: "1v1" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Gagnés" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Perdus" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Réussite" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Comparer" }));
    expect(screen.getAllByText("Kills").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Profil" }));
    expect(screen.getByRole("heading", { name: "Player One" })).toBeInTheDocument();
    expect(screen.getByText("Combat")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Positionnement" }));
    expect(screen.getByRole("heading", { name: "Positionnement" })).toBeInTheDocument();
    expect(screen.getByText("Occupation par zone")).toBeInTheDocument();
    expect(screen.getByText("Espacement")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Voir les trajectoires de Player One",
      }),
    );
    expect(screen.getByRole("combobox", { name: "Compared player" })).toHaveValue("player:1");
    await waitFor(() => expect(screen.getByText("1 rounds")).toBeInTheDocument());
  });

  it("restores a finite replay map after leaving the report", async () => {
    const user = userEvent.setup();
    render(<MatchViewer id="match-report-return" />);
    await screen.findByRole("heading", { level: 1, name: "RoundLab match replay" });
    await waitFor(() =>
      expect(mocks.getRound).toHaveBeenCalledWith("match-report-return", 1, false),
    );

    await user.click(screen.getByRole("button", { name: "Rapport" }));
    expect(await screen.findByRole("heading", { name: "Rapport du match" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Replay libre" }));
    const radar = await screen.findByRole("img", { name: "Interactive replay radar" });
    const width = Number.parseFloat(radar.style.width);
    const height = Number.parseFloat(radar.style.height);
    expect(Number.isFinite(width) && width > 0).toBe(true);
    expect(Number.isFinite(height) && height > 0).toBe(true);
  });

  it("does not retain every full round while building analysis or trajectories", async () => {
    const user = userEvent.setup();
    const metadataRounds = Array.from({ length: 6 }, (_, index) => ({
      ...replayRound(index + 1, 12),
      frames: [],
    }));
    mocks.getMatchMetadata.mockResolvedValue(replayMatch(metadataRounds));
    mocks.getRound.mockImplementation(async (_matchId: string, roundNumber: number) => replayRound(roundNumber, 12));

    render(<MatchViewer id="match-memory" />);
    await screen.findByRole("heading", { level: 1, name: "RoundLab match replay" });
    await waitFor(() => expect(mocks.getRound).toHaveBeenCalledWith("match-memory", 1, false));

    await user.click(screen.getByRole("button", { name: "Rapport" }));
    expect(await screen.findByRole("heading", { name: "Rapport du match" }))
      .toBeInTheDocument();
    const retainedAfterAnalysis = useReplay.getState().match?.rounds
      .filter((round) => round.frames.length > 0)
      .map((round) => round.number);
    expect(retainedAfterAnalysis).toEqual([1, 2]);

    await user.click(screen.getByRole("button", { name: "Trajectoires" }));
    await waitFor(() => expect(screen.getByText("6 rounds")).toBeInTheDocument());

    const retainedRounds = useReplay.getState().match?.rounds
      .filter((round) => round.frames.length > 0)
      .map((round) => round.number);
    expect(retainedRounds).toEqual([1, 2]);
  });
});
