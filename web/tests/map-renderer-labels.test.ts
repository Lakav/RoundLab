import { describe, expect, it } from "vitest";
import {
  layoutPlayerLabels,
  type LabelBox,
} from "@/components/replay/map-renderer-labels";

const BASE = -22;

function box(overrides: Partial<LabelBox> = {}): LabelBox {
  return { x: 0, y: 0, width: 40, height: 12, priority: 0, ...overrides };
}

/** Resolved label rectangles, in the same order as the input boxes. */
function rects(boxes: readonly LabelBox[]) {
  const placements = layoutPlayerLabels(boxes, BASE);
  return placements.map((placement, index) => ({
    left: boxes[index].x + placement.dx - boxes[index].width / 2,
    right: boxes[index].x + placement.dx + boxes[index].width / 2,
    top: boxes[index].y + placement.dy - boxes[index].height / 2,
    bottom: boxes[index].y + placement.dy + boxes[index].height / 2,
    displaced: placement.displaced,
  }));
}

function anyOverlap(boxes: readonly LabelBox[]): boolean {
  const r = rects(boxes);
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i];
      const b = r[j];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
        return true;
      }
    }
  }
  return false;
}

describe("player label layout", () => {
  it("leaves a lone label in its default slot", () => {
    const [placement] = layoutPlayerLabels([box()], BASE);
    expect(placement).toEqual({ dx: 0, dy: BASE, displaced: false });
  });

  it("keeps well-separated labels in their default slots", () => {
    const placements = layoutPlayerLabels(
      [box({ x: 0 }), box({ x: 300 }), box({ y: 300 })],
      BASE,
    );
    expect(placements.every((p) => !p.displaced)).toBe(true);
    expect(placements.every((p) => p.dx === 0 && p.dy === BASE)).toBe(true);
  });

  it("separates two players standing on the same spot", () => {
    const boxes = [box({ x: 100, y: 100 }), box({ x: 100, y: 100 })];
    expect(anyOverlap(boxes)).toBe(false);
  });

  it("keeps ten stacked players readable", () => {
    // A full team stack is the worst realistic case: every marker within a few
    // pixels of the others.
    const boxes = Array.from({ length: 10 }, (_, index) =>
      box({ x: 200 + (index % 3), y: 200 + (index % 2), priority: index }),
    );
    expect(anyOverlap(boxes)).toBe(false);
  });

  it("gives the highest priority its default slot", () => {
    const boxes = [
      box({ x: 50, y: 50, priority: 0 }),
      box({ x: 50, y: 50, priority: 9 }),
    ];
    const placements = layoutPlayerLabels(boxes, BASE);
    expect(placements[1]).toEqual({ dx: 0, dy: BASE, displaced: false });
    expect(placements[0].displaced).toBe(true);
  });

  it("keeps every label near its own marker", () => {
    const boxes = Array.from({ length: 10 }, (_, index) =>
      box({ x: 200, y: 200, priority: index }),
    );
    const placements = layoutPlayerLabels(boxes, BASE);
    for (const placement of placements) {
      // A label that drifts far from its marker no longer identifies anyone.
      // One column across (a full 40px label plus its gutter) and a few rows
      // down is the most a ten-player stack should ever need.
      expect(Math.abs(placement.dx)).toBeLessThanOrEqual(43);
      expect(Math.abs(placement.dy - BASE)).toBeLessThanOrEqual(55);
    }
  });

  it("is stable for the same input", () => {
    const boxes = Array.from({ length: 6 }, (_, index) =>
      box({ x: 100, y: 100, priority: index }),
    );
    expect(layoutPlayerLabels(boxes, BASE)).toEqual(layoutPlayerLabels(boxes, BASE));
  });

  it("keeps labels clear of the markers themselves", () => {
    const boxes = [
      box({ x: 100, y: 100, priority: 1 }),
      box({ x: 100, y: 140, priority: 0 }),
    ];
    const placements = layoutPlayerLabels(boxes, BASE, 13);
    placements.forEach((placement, index) => {
      const lx = boxes[index].x + placement.dx;
      const ly = boxes[index].y + placement.dy;
      for (const marker of boxes) {
        const overlapsMarker =
          Math.abs(lx - marker.x) * 2 < boxes[index].width + 26 &&
          Math.abs(ly - marker.y) * 2 < boxes[index].height + 26;
        expect(overlapsMarker).toBe(false);
      }
    });
  });

  it("returns one placement per box", () => {
    expect(layoutPlayerLabels([], BASE)).toEqual([]);
    expect(layoutPlayerLabels([box(), box()], BASE)).toHaveLength(2);
  });

  it("separates labels of differing widths", () => {
    const boxes = [
      box({ x: 100, y: 100, width: 90, priority: 2 }),
      box({ x: 100, y: 100, width: 24, priority: 1 }),
      box({ x: 110, y: 100, width: 60, priority: 0 }),
    ];
    expect(anyOverlap(boxes)).toBe(false);
  });
});
