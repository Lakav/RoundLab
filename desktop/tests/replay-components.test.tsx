import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controls } from "@/components/replay/Controls";
import { KillFeed } from "@/components/replay/KillFeed";
import { RoundClock } from "@/components/replay/RoundClock";
import { RoundList } from "@/components/replay/RoundList";
import { Timeline } from "@/components/replay/Timeline";
import { useReplay } from "@/lib/replay-store";
import { replayMatch, replayRound } from "./fixtures";

describe("replay controls and status components", () => {
  beforeEach(() => {
    useReplay.getState().setMatch("match-a", replayMatch());
  });

  it("plays, seeks and selects speed only when the round payload is loaded", async () => {
    const user = userEvent.setup();
    render(<Controls />);
    await user.click(screen.getByTitle("Play/Pause (Space)"));
    expect(useReplay.getState().playing).toBe(true);
    await user.click(screen.getByTitle("+5s (L)"));
    expect(useReplay.getState().time).toBe(5);
    await user.click(screen.getByTitle("-5s (J)"));
    expect(useReplay.getState().time).toBe(0);
    await user.click(screen.getByRole("button", { name: "4×" }));
    expect(useReplay.getState().speed).toBe(4);
  });

  it("disables controls while a round payload is loading", () => {
    useReplay.getState().setMatch("match-a", replayMatch([{ ...replayRound(1), frames: [] }]));
    render(<Controls />);
    expect(screen.getAllByTitle("Loading round...")).toHaveLength(3);
    for (const control of screen.getAllByTitle("Loading round...")) expect(control).toBeDisabled();
    expect(screen.getByRole("button", { name: "1×" })).toBeDisabled();
  });

  it("selects a round from the horizontal round list", async () => {
    const user = userEvent.setup();
    render(<RoundList />);
    await user.click(screen.getByRole("button", { name: "02" }));
    expect(useReplay.getState().currentRoundIdx).toBe(1);
  });

  it("shows round and post-plant clock values", () => {
    const round = {
      ...replayRound(1, 160),
      events: [{ t: 100, type: "bomb_planted" as const }],
    };
    useReplay.getState().setMatch("match-a", replayMatch([round]));
    useReplay.getState().setTime(110);
    const view = render(<RoundClock />);
    expect(screen.getByText("00:30")).toBeInTheDocument();
    view.unmount();

    useReplay.getState().setTime(10);
    render(<RoundClock />);
    expect(screen.getByText("01:45")).toBeInTheDocument();
  });

  it("renders recent kills and hides expired ones", () => {
    const round = {
      ...replayRound(1),
      events: [{ t: 2, type: "kill" as const, killer: 1, victim: 2, weapon: "ak47", hs: true }],
    };
    const match = replayMatch([round]);
    match.players.push({ steamId: 2, name: "Victim", team: "CT" });
    useReplay.getState().setMatch("match-a", match);
    useReplay.getState().setTime(5);
    const view = render(<KillFeed />);
    expect(screen.getByText("Player One")).toBeInTheDocument();
    expect(screen.getByText("Victim")).toBeInTheDocument();
    expect(screen.getByText("HS")).toBeInTheDocument();
    view.unmount();

    useReplay.getState().setTime(9);
    expect(render(<KillFeed />).container).toBeEmptyDOMElement();
  });

  it("seeks from a timeline pointer position and displays elapsed time", () => {
    useReplay.getState().setTime(5);
    const { container } = render(<Timeline />);
    expect(screen.getByText("0:05")).toBeInTheDocument();
    expect(screen.getByText("0:10")).toBeInTheDocument();
    const pointerTarget = container.querySelector(".h-8");
    if (!pointerTarget) throw new Error("timeline pointer target missing");
    pointerTarget.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 20,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(pointerTarget, { clientX: 150 });
    expect(useReplay.getState().time).toBe(7.5);
  });
});
