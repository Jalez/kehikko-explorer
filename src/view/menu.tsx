import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef } from 'react'

import { spell } from '../../tree/paths.ts'

import { cn } from '@/lib/utils.ts'
import { copy, type Copied } from '@/lib/copy.ts'
import { place } from '@/view/place.ts'

/**
 * The menu that comes up on a row, and the two things it will do.
 *
 * ## What is in it
 *
 * Copy path, and copy relative path. That is the whole menu, and the wording is
 * VS Code's on purpose: the complaint that produced this was "unlike in vscode
 * explorer", so somebody arriving with that expectation should find the two
 * labels they already know rather than two better ones they have to read.
 *
 * ## What is NOT in it, which is most of what VS Code has
 *
 * Open, Open to the Side, Reveal in Finder, Open in Integrated Terminal, Cut,
 * Copy, Paste, Rename, Delete, New File, New Folder, Compare, Find in Folder.
 * Every one of those is either a write — and `manifest.ts` spends a page
 * arguing that this module has no write half at all, with `test/doors.test.ts`
 * asserting the absence — or a capability this app does not have and would have
 * to be granted. "Reveal in Finder" is the tempting one and it is not close:
 * nothing in this page can ask an operating system to open anything, and a menu
 * item that needs a new permission on every module frame to work is a much
 * larger change than the one somebody asked for.
 *
 * Two other candidates were considered and left out on their merits rather than
 * on a rule:
 *
 * - **Copy name.** One row for a string that is already the visible text of the
 *   row it was opened on, selectable nowhere but obtainable by reading it. It
 *   would be the most-drawn and least-pressed item in the menu.
 * - **Open** (that is, point the canvas). Pressing the row already does it, it
 *   is the single most-used interaction in this container, and putting it in a
 *   menu would make the menu a second way to select — which is the one thing
 *   this menu must not become, because then right-clicking to copy a path would
 *   be one slip away from moving every other container on the canvas.
 *
 * A two-item menu looks thin next to VS Code's. It is the honest size for a
 * module that shows names and does not touch files.
 *
 * ## Opening the menu never points the canvas
 *
 * `manifest.ts` bounds `passage:set` to a person pressing a row, and nothing in
 * this file calls `point`. A right-click is not a press: it does not select the
 * row, it does not move the canvas, and it leaves whatever the canvas was
 * showing alone. That matters more than it sounds — the reason to open this
 * menu is usually to copy the path of a file OTHER than the one being read, and
 * a menu that stole the canvas on the way would make that impossible.
 *
 * ## Hand-written rather than Radix, and this is the one arguable call here
 *
 * `@radix-ui/react-context-menu` does all of this properly and would be the
 * obvious choice if it were already vendored. It is not: this repository has
 * `@radix-ui/react-slot` for shadcn's `Button` and nothing else.
 *
 * What tipped it is that the two behaviours most likely to break here — the
 * placement in a 220-pixel container, and the clipboard write through a
 * cross-origin frame — are both things Radix would not have done for us, and
 * both are now pure functions with their own tests (`view/place.ts`,
 * `lib/copy.ts`). What Radix WOULD have brought is a floating-ui measurement
 * pass that happy-dom cannot run, so the menu's own tests would have had to
 * become a browser probe or be abandoned. A menu of two items, on one anchor,
 * with no submenus and no checkable items, is a small enough surface to own —
 * and it is owned in one file with a keyboard model that is asserted rather
 * than assumed.
 *
 * If a third module in this workspace grows a menu, this decision should be
 * revisited by vendoring the primitive rather than by copying this file.
 */

/** How tall one item is. Slightly taller than a tree row: a menu is a target, not a list to scan. */
const ITEM_HEIGHT = 24
/**
 * Everything the menu is tall that is not an item: the `py-1` above the first
 * and below the last, and the one-pixel border on each side.
 *
 * The border is in the number because it is in the BOX, and leaving it out was
 * a measured two-pixel error — the menu was placed as if it were 56 tall and
 * drawn 58, so an anchor two pixels inside the bottom margin produced a menu two
 * pixels outside it. Two pixels is invisible and it is also exactly the kind of
 * drift that makes the containment assertions in `test/place.test.ts` pass
 * against a menu that does not quite fit.
 */
const MENU_PADDING = 10
/** How wide the menu would like to be. `place` narrows it when the frame is narrower. */
const MENU_WIDTH = 168

/** Which row the menu was opened on, and where. */
export interface MenuAt {
  /** The row's path, relative to the project root — the spelling `read.ts` produces. */
  path: string
  /** Where in the frame to draw the menu. */
  x: number
  y: number
  /**
   * What to put focus back on when the menu closes.
   *
   * Held rather than looked up, because the row it belongs to may be scrolled
   * out of the DOM by the time the menu closes — the list is virtualized. A
   * detached element refuses focus harmlessly, where a `querySelector` for a
   * row that no longer exists would silently drop focus to `<body>` and lose a
   * keyboard user's place in the tree.
   */
  from: HTMLElement | null
}

/**
 * The items, built from the row's path.
 *
 * A list rather than two hand-written buttons, so that the keyboard navigation
 * below is written once against a length instead of against two special cases —
 * which is where a third item, added later by somebody in a hurry, would
 * otherwise become an item the arrow keys skip.
 */
function itemsFor(projectPath: string, path: string) {
  const { absolute, relative } = spell(projectPath, path)
  return [
    { label: 'Copy path', text: absolute },
    /*
     * "relative path" is left unqualified in the LABEL and qualified in the
     * `title`, which is the compromise this container's width forces. Relative
     * to what is a fair question and the answer is "the project root the canvas
     * is open on" — a sentence that does not fit in a 168-pixel menu and would
     * be the longest thing on screen if it did. The hover text carries it, and
     * so does the string itself, which is right there in the same tooltip.
     */
    { label: 'Copy relative path', text: relative },
  ]
}

export function RowMenu({
  at,
  projectPath,
  onCopied,
  onClose,
}: {
  at: MenuAt
  /** The project root the host named. The base every relative path here is relative to. */
  projectPath: string
  /** Told what happened to every copy, so the page can say so when nothing was copied. */
  onCopied: (result: Copied) => void
  onClose: () => void
}) {
  const items = useMemo(() => itemsFor(projectPath, at.path), [projectPath, at.path])
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const menu = useRef<HTMLDivElement | null>(null)

  /*
   * The placement, from the frame's viewport rather than from any element.
   *
   * `window.innerWidth/Height` is the right box here and would be wrong in a
   * page that scrolled: the body is a fixed-height, non-scrolling box (see
   * `page/document.ts`), so the viewport IS the whole document and a
   * `position: fixed` menu inside the viewport is inside the frame. There is
   * no scroll offset to add, and adding one would be a bug that only appeared
   * if that decision were ever reversed.
   */
  const spot = useMemo(
    () =>
      place(
        { x: at.x, y: at.y },
        { width: MENU_WIDTH, height: items.length * ITEM_HEIGHT + MENU_PADDING },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    [at.x, at.y, items.length],
  )

  /**
   * Closing, with focus put back where it came from.
   *
   * A menu that closes and leaves focus on nothing is a keyboard trap in
   * reverse: the person opened it from a row, and after Escape they are at the
   * top of the document with no way back to where they were except Tab. So the
   * element the menu was opened from is focused again on the way out, always —
   * after Escape, after an outside click, and after an item was chosen.
   */
  const close = useCallback(() => {
    onClose()
    at.from?.focus({ preventScroll: true })
  }, [onClose, at.from])

  /**
   * Choosing an item: close first, copy second.
   *
   * The order is load-bearing and it is not about tidiness. The clipboard
   * fallback in `lib/copy.ts` puts a `<textarea>` in the document, focuses it,
   * and gives focus back to whatever had it — so if the menu were still open,
   * "whatever had it" would be a menu item that is about to be unmounted, and
   * focus would end up on `<body>`. Closing first means the row is already
   * focused when the textarea borrows and returns focus, and the person lands
   * back on the row they right-clicked.
   *
   * Both halves still run inside the user gesture, which is what
   * `execCommand('copy')` requires: React flushes the close before this handler
   * returns, and the copy's `await` resolves well inside the activation window.
   */
  const choose = useCallback(
    (text: string) => {
      close()
      void copy(text).then(onCopied)
    },
    [close, onCopied],
  )

  /* Focus lands on the first item as the menu opens, which is what makes
     Shift+F10 followed by Enter a complete interaction rather than the start of
     a hunt for where the focus went. */
  useEffect(() => {
    buttons.current[0]?.focus({ preventScroll: true })
  }, [at.path, at.x, at.y])

  /*
   * Everything that dismisses the menu without choosing anything.
   *
   * On `pointerdown` rather than `click`, because a click outside a menu is
   * usually meant for the thing under the pointer and a menu that closes on
   * mouse-UP eats that press. On `scroll` in the capture phase, because the
   * scroller is a descendant and scroll does not bubble — a menu that stayed
   * put while the rows moved under it would be pointing at a different file
   * than the one it was opened on, which is the one way this menu could copy
   * the wrong path. `resize` for the same reason: the host resizes these frames.
   *
   * A second `contextmenu` anywhere closes it too; the row that received it
   * opens its own straight afterwards, so right-clicking from one row to the
   * next behaves the way it does everywhere else.
   */
  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event.type === 'pointerdown' && event.target instanceof Node && menu.current?.contains(event.target)) return
      close()
    }
    window.addEventListener('pointerdown', dismiss, true)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('pointerdown', dismiss, true)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [close])

  /**
   * The keyboard model, which is the whole reason this is a `role="menu"` and
   * not a list of buttons.
   *
   * Arrows move and WRAP — a two-item menu where Down on the last item does
   * nothing is a menu that feels broken, and wrapping is what the WAI-ARIA menu
   * pattern specifies. Home and End are there because they cost two lines and
   * are what a screen-reader user reaches for. Tab CLOSES rather than moving
   * within the menu: a menu is a modal thing, and tabbing out of one while it
   * stays open leaves a floating panel over a page nobody is looking at.
   *
   * Enter and Space are not handled here at all, deliberately: the items are
   * real `<button>` elements, so the browser already activates them on both,
   * and a hand-written duplicate would be a second implementation that can
   * disagree with the first.
   */
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const focused = buttons.current.findIndex((button) => button === document.activeElement)
    const last = items.length - 1
    const go = (index: number) => {
      event.preventDefault()
      buttons.current[index]?.focus({ preventScroll: true })
    }
    if (event.key === 'ArrowDown') return go(focused >= last ? 0 : focused + 1)
    if (event.key === 'ArrowUp') return go(focused <= 0 ? last : focused - 1)
    if (event.key === 'Home') return go(0)
    if (event.key === 'End') return go(last)
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault()
      close()
    }
  }

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Actions for this file"
      data-testid="row-menu"
      data-path={at.path}
      onKeyDown={onKeyDown}
      /* `position: fixed` in a document that does not scroll, so these are the
         frame's own coordinates and nothing has to be corrected for. */
      style={{ position: 'fixed', left: spot.left, top: spot.top, width: spot.width }}
      className="z-50 rounded-md border bg-card py-1 text-card-foreground shadow-md"
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          ref={(element) => {
            buttons.current[index] = element
          }}
          data-testid="menu-item"
          data-copies={item.text}
          /* The exact string that will be copied, on hover. It is the answer to
             "relative to what" and to "is that the path I think it is", and it
             costs no pixels until somebody wants it. */
          title={item.text}
          className={cn(
            'flex w-full items-center truncate rounded-sm px-2 text-left text-xs',
            'hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none',
          )}
          style={{ height: ITEM_HEIGHT }}
          onClick={() => choose(item.text)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
