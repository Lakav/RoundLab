import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReplayAccessibilitySummary } from "@/components/replay/ReplayAccessibilitySummary";
import { useReplay } from "@/lib/replay-store";
import { replayMatch, replayRound } from "./fixtures";

describe("ReplayAccessibilitySummary", () => {
  beforeEach(() => {
    const round = {
      ...replayRound(1),
      frames: [{
        t: 0,
        players: [{ id: 1, x: 10, y: 20, z: 30, yaw: 90, hp: 100, armor: 50, team: 2 }],
        bomb: { x: 5, y: 6, z: 7, status: "planted" as const },
      }],
      events: [{ t: 2, type: "kill" as const, killer: 1, victim: 2, weapon: "ak47", hs: true }],
    };
    const match = replayMatch([round]);
    match.players.push({ steamId: 2, name: "Player Two", team: "CT" });
    useReplay.getState().setMatch("accessible-match", match);
    useReplay.getState().setTime(3);
  });

  it("describes the map, current players, bomb and recent events", () => {
    render(<ReplayAccessibilitySummary />);
    const summary = screen.getByRole("region", { name: "Text alternative for the replay radar" });
    expect(summary).toHaveTextContent("Map de_nuke");
    expect(summary).toHaveTextContent("Player One, Terrorist, 100 health");
    expect(summary).toHaveTextContent("Bomb planted");
    expect(summary).toHaveTextContent("Player One eliminated Player Two with ak47, headshot");
  });
});
