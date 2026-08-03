import { beforeEach, describe, expect, it } from "vitest";
import { useReplay } from "@/lib/replay-store";
import { replayMatch, replayRound } from "./fixtures";

describe("replay state machine", () => {
  beforeEach(() => {
    useReplay.getState().setMatch("match-a", replayMatch());
  });

  it("resets transient replay state when a match is selected", () => {
    const state = useReplay.getState();
    state.setSpeed(4);
    state.setPlaying(true);
    state.setHabitOverlay({ label: "test", trails: [] });
    state.setMatch("match-b", replayMatch([replayRound(3)]));
    expect(useReplay.getState()).toMatchObject({
      matchId: "match-b",
      currentRoundIdx: 0,
      time: 0,
      playing: false,
      speed: 1,
      durationOverride: null,
      habitOverlay: null,
    });
  });

  it("accepts only a loaded payload for a known round and current match", () => {
    const replacement = replayRound(1, 25);
    useReplay.getState().setRoundData("other", 1, replacement);
    expect(useReplay.getState().currentRound()?.duration).toBe(10);

    useReplay.getState().setRoundData("match-a", 99, replayRound(99));
    expect(useReplay.getState().match?.rounds).toHaveLength(2);

    useReplay.getState().setRoundData("match-a", 1, { ...replacement, frames: [] });
    expect(useReplay.getState().playing).toBe(false);

    useReplay.getState().setRoundData("match-a", 1, replacement);
    expect(useReplay.getState().currentRound()?.duration).toBe(25);
  });

  it("keeps full payloads only for the current round and its neighbours", () => {
    const metadataRounds = Array.from({ length: 6 }, (_, index) => ({
      ...replayRound(index + 1),
      frames: [],
    }));
    useReplay.getState().setMatch("match-a", replayMatch(metadataRounds));

    for (let number = 1; number <= 6; number++) {
      useReplay.getState().setRoundData("match-a", number, replayRound(number));
    }
    expect(
      useReplay.getState().match?.rounds
        .filter((round) => round.frames.length > 0)
        .map((round) => round.number),
    ).toEqual([1, 2]);

    useReplay.getState().setRound(3);
    for (const number of [3, 4, 5]) {
      useReplay.getState().setRoundData("match-a", number, replayRound(number));
    }
    expect(
      useReplay.getState().match?.rounds
        .filter((round) => round.frames.length > 0)
        .map((round) => round.number),
    ).toEqual([3, 4, 5]);

    useReplay.getState().setRound(5);
    useReplay.getState().setRoundData("match-a", 6, replayRound(6));
    expect(
      useReplay.getState().match?.rounds
        .filter((round) => round.frames.length > 0)
        .map((round) => round.number),
    ).toEqual([5, 6]);
  });

  it("trims an already-loaded match as soon as it enters the store", () => {
    useReplay.getState().setMatch(
      "match-a",
      replayMatch(Array.from({ length: 5 }, (_, index) => replayRound(index + 1))),
    );
    expect(
      useReplay.getState().match?.rounds
        .filter((round) => round.frames.length > 0)
        .map((round) => round.number),
    ).toEqual([1, 2]);
  });

  it("guards round selection, time, speed and play state", () => {
    const state = useReplay.getState();
    state.setRound(1);
    expect(useReplay.getState()).toMatchObject({ currentRoundIdx: 1, time: 0, playing: false });
    useReplay.getState().setRound(99);
    expect(useReplay.getState().currentRoundIdx).toBe(1);

    useReplay.getState().setTime(999);
    expect(useReplay.getState().time).toBe(10);
    useReplay.getState().setTime(Number.NaN);
    expect(useReplay.getState().time).toBe(0);
    useReplay.getState().setSpeed(3);
    expect(useReplay.getState().speed).toBe(1);
    useReplay.getState().setSpeed(2);
    expect(useReplay.getState().speed).toBe(2);

    useReplay.getState().togglePlay();
    expect(useReplay.getState().playing).toBe(true);
    useReplay.getState().togglePlay();
    expect(useReplay.getState().playing).toBe(false);
  });

  it("stops playback on unloaded rounds", () => {
    useReplay.getState().setMatch("match-a", replayMatch([{ ...replayRound(1), frames: [] }]));
    useReplay.getState().setPlaying(true);
    expect(useReplay.getState().playing).toBe(false);
    useReplay.getState().togglePlay();
    expect(useReplay.getState().playing).toBe(false);
  });

  it("advances within and across rounds without skipping unloaded payloads", () => {
    useReplay.getState().setPlaying(true);
    useReplay.getState().step(2);
    expect(useReplay.getState().time).toBe(2);
    useReplay.getState().step(8);
    expect(useReplay.getState()).toMatchObject({ currentRoundIdx: 1, time: 0, playing: true });
    useReplay.getState().step(10);
    expect(useReplay.getState()).toMatchObject({ time: 10, playing: false });

    useReplay.getState().setMatch("match-a", replayMatch([replayRound(1), { ...replayRound(2), frames: [] }]));
    useReplay.getState().setPlaying(true);
    useReplay.getState().step(10);
    expect(useReplay.getState()).toMatchObject({ currentRoundIdx: 1, playing: false });
  });

  it("clamps condensed-mode duration overrides", () => {
    useReplay.getState().setTime(8);
    useReplay.getState().setDurationOverride(5);
    expect(useReplay.getState()).toMatchObject({ durationOverride: 5, time: 5 });
    useReplay.getState().setPlaying(true);
    useReplay.getState().setTime(0);
    useReplay.getState().step(5);
    expect(useReplay.getState()).toMatchObject({ time: 5, playing: false });
    useReplay.getState().setDurationOverride(Number.NaN);
    expect(useReplay.getState().durationOverride).toBeNull();
    useReplay.getState().setDurationOverride(-2);
    expect(useReplay.getState().durationOverride).toBe(0);
  });

  it("ignores invalid time deltas and exposes the current round", () => {
    useReplay.getState().setPlaying(true);
    useReplay.getState().step(0);
    useReplay.getState().step(Number.NaN);
    expect(useReplay.getState().time).toBe(0);
    expect(useReplay.getState().currentRound()?.number).toBe(1);
  });
});
