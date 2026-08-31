import { describe, expect, test } from 'bun:test'

import { place } from '../src/view/place.ts'

/**
 * Where a menu lands, in a container the size this app is actually used at.
 *
 * 220x300 is the size the whole module is designed around and the only size at
 * which any of this can go wrong: in a 900x700 frame every arrangement of this
 * arithmetic puts the menu somewhere reasonable. The frame does not scroll, so
 * a menu placed past an edge is not awkward, it is unreachable.
 *
 * The assertion in nearly every test below is the same one — the whole menu is
 * inside the frame — written as an explicit box check rather than as expected
 * coordinates, because the coordinates are an implementation detail and the
 * containment is the requirement.
 */

const NARROW = { width: 220, height: 300 }
const WIDE = { width: 900, height: 700 }
const MENU = { width: 168, height: 56 }
const MARGIN = 4

/** Whether every edge of the placed menu is inside the frame. */
function inside(at: { left: number; top: number; width: number }, view: { width: number; height: number }) {
  return (
    at.left >= MARGIN
    && at.top >= MARGIN
    && at.left + at.width <= view.width - MARGIN
    && at.top + MENU.height <= view.height - MARGIN
  )
}

describe('the ordinary case', () => {
  test('opens down and to the right of the pointer, which is where a hand expects it', () => {
    const at = place({ x: 40, y: 30 }, MENU, WIDE)
    expect(at.left).toBe(40)
    expect(at.top).toBe(30)
    expect(at.width).toBe(168)
  })
})

describe('a container 220 pixels wide', () => {
  /*
   * The failure this module would actually have shipped. 168 pixels of menu
   * from x=140 runs 88 pixels past the right edge of a 220-pixel frame, and
   * there is no horizontal scroll to recover it with.
   *
   * At this width the flip alone cannot save it either — 140 minus 168 is off
   * the other edge — so this is the case the shift exists for, and the menu
   * ends up against the right margin.
   */
  test('a menu near the right edge of a narrow frame is brought back inside it', () => {
    const at = place({ x: 140, y: 30 }, MENU, NARROW)
    expect(at.left).toBe(NARROW.width - MARGIN - MENU.width)
    expect(inside(at, NARROW)).toBe(true)
  })

  /* Where there IS room on the other side, it flips rather than shifting — the
     menu sits beside the pointer instead of under it, so a right-click-and-drag
     does not land on whichever item the arithmetic put beneath the cursor. */
  test('with room on the other side it flips, so the menu is never under the pointer', () => {
    const at = place({ x: 850, y: 30 }, MENU, WIDE)
    expect(at.left).toBe(850 - MENU.width)
    expect(inside(at, WIDE)).toBe(true)
  })

  test('every point along the top edge produces a menu inside the frame', () => {
    for (let x = 0; x <= NARROW.width; x += 5) {
      const at = place({ x, y: 20 }, MENU, NARROW)
      expect(`x=${x}:${inside(at, NARROW)}`).toBe(`x=${x}:true`)
    }
  })

  test('every point along the left edge produces a menu inside the frame', () => {
    for (let y = 0; y <= NARROW.height; y += 5) {
      const at = place({ x: 10, y }, MENU, NARROW)
      expect(`y=${y}:${inside(at, NARROW)}`).toBe(`y=${y}:true`)
    }
  })

  /* The bottom-right corner is where both axes have to give way at once, and
     it is the corner a person right-clicks a deeply nested file in. */
  test('the bottom-right corner still puts the whole menu on screen', () => {
    const at = place({ x: 219, y: 299 }, MENU, NARROW)
    expect(inside(at, NARROW)).toBe(true)
  })

  test('a menu near the bottom flips above the pointer rather than hanging off it', () => {
    const at = place({ x: 10, y: 280 }, MENU, NARROW)
    expect(at.top).toBe(280 - MENU.height)
    expect(inside(at, NARROW)).toBe(true)
  })

  /* At 220 wide there is 212 of usable room and the menu wants 168, so it is
     drawn at its full width — the narrowing below is for frames narrower still. */
  test('is still wide enough for the menu’s natural width', () => {
    expect(place({ x: 10, y: 10 }, MENU, NARROW).width).toBe(168)
  })
})

describe('a frame narrower than the menu', () => {
  /*
   * Not a size a host should produce, and produced anyway by a person dragging
   * a container's edge. The menu narrows rather than hanging off both sides:
   * the labels truncate, which is legible, where an off-frame menu is not.
   */
  test('the menu is narrowed to fit rather than overflowing', () => {
    const tiny = { width: 120, height: 300 }
    const at = place({ x: 60, y: 30 }, MENU, tiny)
    expect(at.width).toBe(112)
    expect(inside(at, tiny)).toBe(true)
  })

  test('a frame smaller than its own margins never produces a negative width', () => {
    expect(place({ x: 0, y: 0 }, MENU, { width: 2, height: 2 }).width).toBe(0)
  })
})

describe('a menu taller than the frame', () => {
  /*
   * Cut off at the BOTTOM rather than the top. A menu whose first item is above
   * the frame has no reachable items at all; one whose last item is below it
   * still opens, still takes arrow keys, and still copies.
   */
  test('keeps its top edge on screen and loses the bottom', () => {
    const at = place({ x: 10, y: 100 }, { width: 168, height: 400 }, NARROW)
    expect(at.top).toBe(MARGIN)
  })
})
