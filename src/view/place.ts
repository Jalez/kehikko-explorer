/**
 * Where a menu goes so that all of it is on screen.
 *
 * ## Why this is a pure function with its own test file
 *
 * Because it is the part of a context menu that is impossible to see wrong
 * until the one moment it matters. A menu opened from a row near the top-left
 * of a wide container is correct under every arithmetic mistake in here; the
 * bug only appears on the last row of a container 220 pixels wide, which is
 * this app's NORMAL size and the hardest place to catch anything by looking.
 * The frame does not scroll — `page/document.ts` makes the body a fixed-height
 * non-scrolling box — so a menu placed past the edge is not merely awkward, it
 * is unreachable, and the person's only recourse is to press Escape and resize
 * a container to read two menu items.
 *
 * So the geometry takes four numbers and returns three, touches no DOM, and
 * `test/place.test.ts` puts it in every corner of a 220x300 box.
 *
 * ## Flip, then clamp — in that order, and the order is the decision
 *
 * A menu that will not fit to the right of the pointer FLIPS to the left of it,
 * which is what every native menu on every platform does and therefore what a
 * hand expects. Only if the flipped position is also off screen does it get
 * SHIFTED to sit against the far edge instead.
 *
 * Shifting alone would have been fewer lines and is wrong in a specific way: a
 * menu shifted left until it fits sits UNDER the pointer, so the item that lands
 * beneath the cursor is whichever one the arithmetic happened to put there, and
 * a person who right-clicks and drags — a completely ordinary way to use a
 * context menu — activates it. Flipping keeps the menu beside the pointer
 * rather than beneath it.
 *
 * The vertical axis is the same rule for the same reason, and it is the axis
 * that actually fires here: this container is routinely under 300 pixels tall,
 * so almost any row in the bottom third opens a menu that would hang off the
 * bottom.
 */

/** Where the person asked for a menu, in the frame's own coordinates. */
export interface Point {
  x: number
  y: number
}

/** How big something is. */
export interface Size {
  width: number
  height: number
}

/** Where to put the menu and how wide to draw it. Frame coordinates, for `position: fixed`. */
export interface Placement {
  left: number
  top: number
  /**
   * The width to actually draw.
   *
   * Returned rather than assumed, because in a container narrower than the
   * menu's natural width the honest answer is a narrower menu, not a menu
   * hanging off both edges. It comes out of this function rather than out of a
   * CSS `max-width` so that the same number is used for the placement
   * arithmetic and for the element — a menu positioned as if it were 176 wide
   * and then drawn at 140 by a stylesheet is a menu that is inside the frame by
   * accident.
   */
  width: number
}

/**
 * How close to the frame's edge a menu is allowed to sit.
 *
 * Small, because the frame edge is a container border on somebody's canvas
 * rather than the edge of a monitor, and a fat margin in a 220-pixel container
 * is width taken from the paths the menu exists to show.
 */
const MARGIN = 4

export function place(at: Point, menu: Size, view: Size, margin: number = MARGIN): Placement {
  /* Never wider than the room there is, and never negative — a view smaller
     than two margins is a frame nobody can use, but it must not produce a
     nonsense width that a browser then renders as "as wide as the content". */
  const width = Math.max(0, Math.min(menu.width, view.width - margin * 2))

  return {
    left: fit(at.x, width, view.width, margin),
    top: fit(at.y, menu.height, view.height, margin),
    width,
  }
}

/**
 * One axis of it.
 *
 * Both axes are the same problem and were written twice before this was
 * factored out, which is how the vertical one ended up with the `<` that should
 * have been `<=`. One function, so a fix to either is a fix to both.
 *
 * The final clamp is what handles a menu LARGER than the frame on this axis:
 * neither the preferred nor the flipped position fits, the shift puts it at a
 * negative coordinate, and the clamp brings it back to the margin — so the top
 * (or left) of the menu is visible and the rest is cut off, which is the right
 * end to lose. A menu whose first item is off screen has no usable items at all.
 */
function fit(at: number, size: number, view: number, margin: number): number {
  /*
   * The anchor is pulled inside the margins BEFORE anything is decided, and
   * this line is the bug that was found by running the whole edge of a
   * 220x300 box through this function rather than by trying a corner.
   *
   * Flipping puts the menu's far edge exactly AT the anchor point. So an anchor
   * one pixel from the frame's bottom — an entirely reachable right-click, on
   * the last row of a short container — flips to a menu whose bottom is one
   * pixel from the frame's bottom, which is inside the frame but outside the
   * margin, and it looked correct in every test that only checked corners.
   * Clamping the anchor first makes both branches below correct by
   * construction instead of by two more conditions.
   */
  const anchor = Math.max(margin, Math.min(at, view - margin))
  /* Fits ahead of the point, which is the ordinary case and the one that must
     not be disturbed by any of the below. */
  if (anchor + size <= view - margin) return anchor
  /* Flip to the other side of the point. */
  if (anchor - size >= margin) return anchor - size
  /* Neither side fits: sit against the far edge, then refuse to go past the near one. */
  return Math.max(margin, view - margin - size)
}
