/* eslint-disable @next/next/no-img-element */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  MapRenderer: ({ descriptionId }: { descriptionId?: string }) => <div role="img" aria-label="Interactive replay radar" aria-describedby={descriptionId} />,
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
    loaded.frames[0].players.push({ id: 2, x: 30, y: 40, z: 10, yaw: 180, hp: 90, armor: 50, team: 3 });
    loaded.events = [{ t: 2, type: "kill", killer: 1, victim: 2, weapon: "ak47" }];
    const metadata = replayMatch([{ ...loaded, frames: [], events: [] }]);
    metadata.players.push({ steamId: 2, name: "Player Two", team: "CT" });
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

  it("supports keyboard playback, zoom and condensed review mode", async () => {
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
    await user.click(screen.getByRole("button", { name: "Condensé" }));
    expect(screen.getByRole("combobox")).toHaveValue("player:1");
  });
});
