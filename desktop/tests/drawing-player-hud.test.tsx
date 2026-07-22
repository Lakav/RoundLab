import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DrawingLayer, type Stroke } from "@/components/replay/DrawingLayer";
import { DrawingToolbar } from "@/components/replay/DrawingToolbar";
import { PlayerHUD } from "@/components/replay/PlayerHUD";
import { useReplay } from "@/lib/replay-store";
import { replayMatch, replayRound } from "./fixtures";

const canvasContext = {
  setTransform: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  closePath: vi.fn(), fill: vi.fn(), strokeRect: vi.fn(), ellipse: vi.fn(), drawImage: vi.fn(),
  lineCap: "", lineJoin: "", strokeStyle: "", fillStyle: "", lineWidth: 1,
};

describe("drawing tools and player HUD", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => canvasContext),
    });
    const round = replayRound(1);
    round.scoreA = 3;
    round.scoreB = 2;
    round.frames[0].players = [
      { id: 1, x: 10, y: 20, z: 0, yaw: 90, hp: 100, armor: 80, helmet: true, money: 3200, team: 2, active: "ak47", weapons: ["ak47", "flashbang"] },
      { id: 2, x: 30, y: 40, z: 0, yaw: 180, hp: 75, armor: 50, money: 2400, team: 3, active: "m4a1", weapons: ["m4a1"] },
    ];
    const match = replayMatch([round]);
    match.players = [
      { steamId: 1, name: "Alice", team: "T" },
      { steamId: 2, name: "Bob", team: "CT" },
    ];
    useReplay.getState().setMatch("hud", match);
  });

  it("renders uniquely labelled player status landmarks", () => {
    render(<><PlayerHUD side="CT" /><PlayerHUD side="T" /></>);
    expect(screen.getByRole("complementary", { name: "Alpha player status" })).toHaveTextContent("Bob");
    expect(screen.getByRole("complementary", { name: "Bravo player status" })).toHaveTextContent("Alice");
  });

  it("draws a pen stroke and exposes named toolbar controls", async () => {
    const user = userEvent.setup();
    const setStrokes = vi.fn();
    const { container } = render(<DrawingLayer size={100} tool="pen" color="#ef4444" width={3} strokes={[]} setStrokes={setStrokes} />);
    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("canvas missing");
    canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) });
    Object.defineProperty(canvas, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(setStrokes).toHaveBeenCalledWith([expect.objectContaining({ tool: "pen" })]);

    const stroke: Stroke = { id: "s", tool: "pen", color: "#fff", width: 2, points: [{ x: 0, y: 0 }] };
    const setTool = vi.fn();
    const setColor = vi.fn();
    render(<DrawingToolbar tool="none" setTool={setTool} color="#ef4444" setColor={setColor} strokes={[stroke]} setStrokes={setStrokes} />);
    await user.click(screen.getByTitle("Pen (Alt+P)"));
    await user.click(screen.getByRole("button", { name: "Drawing color #10b981" }));
    expect(setTool).toHaveBeenCalledWith("pen");
    expect(setColor).toHaveBeenCalledWith("#10b981");
  });
});
