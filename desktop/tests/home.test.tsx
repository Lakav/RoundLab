/* eslint-disable @next/next/no-img-element */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  cancelParse: vi.fn(),
  deleteMatch: vi.fn(),
  getMatchMetadata: vi.fn(),
  listMatches: vi.fn(),
  onParseProgress: vi.fn(),
  parseDemo: vi.fn(),
  renameMatch: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/image", () => ({ default: ({ alt = "", ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt} {...props} /> }));
vi.mock("@/components/SettingsPanel", () => ({ SettingsPanel: () => <button>Settings</button> }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    cancelParse: mocks.cancelParse,
    deleteMatch: mocks.deleteMatch,
    getMatchMetadata: mocks.getMatchMetadata,
    listMatches: mocks.listMatches,
    onParseProgress: mocks.onParseProgress,
    parseDemo: mocks.parseDemo,
    renameMatch: mocks.renameMatch,
  };
});

import Home from "@/app/page";

const summary = { id: "match-1", name: "Practice match", createdAt: 1_700_000_000_000, size: 2048 };

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("Worker", class Worker {});
    mocks.listMatches.mockResolvedValue([summary]);
    mocks.onParseProgress.mockResolvedValue(() => undefined);
    mocks.getMatchMetadata.mockResolvedValue({});
    mocks.renameMatch.mockImplementation(async (id: string, name: string) => ({ ...summary, id, name }));
    mocks.deleteMatch.mockResolvedValue(undefined);
  });

  it("loads the local library and opens a selected match", async () => {
    const user = userEvent.setup();
    render(<Home />);
    expect(await screen.findByText("Practice match")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(mocks.getMatchMetadata).toHaveBeenCalledWith("match-1"));
    expect(mocks.push).toHaveBeenCalledWith("/match/?id=match-1");
  });

  it("rejects an unsupported local file without invoking the parser", async () => {
    render(<Home />);
    const input = screen.getByLabelText("Choose a local CS2 demo file");
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a .dem or .dem.zst file");
    expect(mocks.parseDemo).not.toHaveBeenCalled();
  });

  it("parses a valid demo, renames it and opens the stored match", async () => {
    const user = userEvent.setup();
    mocks.parseDemo.mockResolvedValue("match-1");
    render(<Home />);
    const input = screen.getByLabelText("Choose a local CS2 demo file");
    fireEvent.change(input, { target: { files: [new File(["demo"], "round.dem")] } });
    expect(await screen.findByRole("dialog", { name: "Match parsed" })).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Practice match"), "Final review");
    await user.click(screen.getByRole("button", { name: "Save & open" }));
    await waitFor(() => expect(mocks.renameMatch).toHaveBeenCalledWith("match-1", "Final review"));
    expect(mocks.push).toHaveBeenCalledWith("/match/?id=match-1");
  });

  it("does not start two parses when file events arrive before the UI rerenders", async () => {
    let finishParse: ((id: string) => void) | undefined;
    mocks.parseDemo.mockImplementation(() => new Promise<string>((resolve) => {
      finishParse = resolve;
    }));
    render(<Home />);
    const input = screen.getByLabelText("Choose a local CS2 demo file");

    fireEvent.change(input, { target: { files: [new File(["first"], "first.dem")] } });
    fireEvent.change(input, { target: { files: [new File(["second"], "second.dem")] } });

    expect(mocks.parseDemo).toHaveBeenCalledTimes(1);
    finishParse?.("match-1");
    expect(await screen.findByRole("dialog", { name: "Match parsed" })).toBeInTheDocument();
  });
});
