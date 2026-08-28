/**
 * Keeps player names readable when markers stack up.
 *
 * Names are drawn above their marker by default. When several players occupy
 * the same spot — a stacked spawn, a site execute, a post-plant huddle — those
 * default slots overlap and the names become an unreadable pile. This module
 * assigns each label one of a small set of candidate slots around its marker,
 * preferring the default and falling back outward only as far as needed.
 *
 * The layout runs once per frame over at most ten players, so it stays a
 * straightforward scan rather than a spatial index.
 */

export type LabelBox = {
  /** Marker centre, in radar pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Ties are broken by this, so the order stays stable between frames. */
  priority: number;
};

export type LabelPlacement = {
  /** Offset from the marker centre to the label centre. */
  dx: number;
  dy: number;
  /** True when the label had to leave its default slot. */
  displaced: boolean;
};

/**
 * Candidate offsets as [column, row] multiples of the label size, in the order
 * they are tried: the default slot above the marker first, then rows stepping
 * outward, each row offering the centre column before the two sides.
 *
 * Rows are whole label heights, so stacked labels line up in a readable column
 * instead of landing at arbitrary offsets. The ladder is deep enough that ten
 * players sharing one spot each still get a slot of their own.
 */
const SLOTS: ReadonlyArray<readonly [number, number]> = (() => {
  const slots: Array<readonly [number, number]> = [[0, 0]];
  // Rows spread upward and downward together, and each row fills its side
  // columns before the next row starts. Widening before going further keeps a
  // full stack of ten within a couple of label heights of their markers.
  for (let row = 1; row <= 4; row++) {
    for (const sign of [1, -1] as const) {
      slots.push([0, sign * row]);
      slots.push([1, sign * (row - 0.5)]);
      slots.push([-1, sign * (row - 0.5)]);
      slots.push([1, sign * row]);
      slots.push([-1, sign * row]);
    }
  }
  return slots;
})();

/** Gap kept between two labels, in pixels. */
const GUTTER = 1.5;

function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return (
    Math.abs(ax - bx) * 2 < aw + bw + GUTTER * 2 &&
    Math.abs(ay - by) * 2 < ah + bh + GUTTER * 2
  );
}

/**
 * Places every label, returning one placement per input box in input order.
 *
 * Boxes are laid out from the highest priority down, so the players a viewer
 * cares about most keep their default slot and the rest move around them.
 */
export function layoutPlayerLabels(
  boxes: readonly LabelBox[],
  baseOffsetY: number,
  markerRadius = 0,
): LabelPlacement[] {
  const placements: LabelPlacement[] = boxes.map(() => ({
    dx: 0,
    dy: baseOffsetY,
    displaced: false,
  }));

  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort((left, right) =>
      right.box.priority - left.box.priority ||
      left.box.y - right.box.y ||
      left.index - right.index,
    );

  // Occupied rectangles: every marker first, then each label as it is placed.
  // Seeding the markers stops a name from landing on top of a sprite.
  const taken: Array<{ x: number; y: number; w: number; h: number }> = markerRadius
    ? boxes.map((box) => ({
        x: box.x,
        y: box.y,
        w: markerRadius * 2,
        h: markerRadius * 2,
      }))
    : [];

  for (const { box, index } of order) {
    let chosen: readonly [number, number] = SLOTS[0];
    let free = false;

    for (const slot of SLOTS) {
      const cx = box.x + slot[0] * (box.width + GUTTER * 2);
      const cy = box.y + baseOffsetY + slot[1] * (box.height + GUTTER);
      const clash = taken.some((other) =>
        overlaps(cx, cy, box.width, box.height, other.x, other.y, other.w, other.h),
      );
      if (!clash) {
        chosen = slot;
        free = true;
        break;
      }
    }

    // Every slot is taken: keep the default rather than flinging the label far
    // from its marker, where it would no longer identify anyone.
    const dx = chosen[0] * (box.width + GUTTER * 2);
    const dy = baseOffsetY + chosen[1] * (box.height + GUTTER);
    placements[index] = {
      dx,
      dy,
      displaced: free && (chosen[0] !== 0 || chosen[1] !== 0),
    };
    taken.push({ x: box.x + dx, y: box.y + dy, w: box.width, h: box.height });
  }

  return placements;
}
