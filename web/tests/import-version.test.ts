import { describe, expect, it } from "vitest";
import {
  isLegacyImport,
  versionCurrentImport,
} from "@/lib/import-version";
import { replayMatch } from "./fixtures";

describe("import version manifest", () => {
  it("records full parser and analysis capabilities without inventing geometry", () => {
    const versioned = versionCurrentImport({
      ...replayMatch(),
      schemaVersion: "roundlab.replay.v2",
      parserVersion: "test-parser",
    }, "full");

    expect(versioned).toMatchObject({
      mechanicsFormulaVersion: "roundlab.mechanics.v2",
      importQuality: "partial",
      geometryVersion: null,
    });
    expect(versioned.capabilities).toEqual(expect.arrayContaining([
      "weapon_fires",
      "hitgroups",
      "pitch_yaw",
      "velocity",
      "spotted_by",
      "full_frame_sampling",
    ]));
    expect(versioned.capabilities).not.toContain("bullet_impacts");
    expect(isLegacyImport(versioned)).toBe(false);
  });

  it("marks reduced frame sampling as partial", () => {
    const versioned = versionCurrentImport(replayMatch(), "high");

    expect(versioned.importQuality).toBe("partial");
    expect(versioned.capabilities).toContain("reduced_frame_sampling");
  });

  it("detects imports created before the manifest contract", () => {
    expect(isLegacyImport(replayMatch())).toBe(true);
  });
});
