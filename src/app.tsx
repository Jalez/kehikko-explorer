import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ID } from '../manifest.ts'
import { flatten } from '../tree/flatten.ts'
import { absoluteOf, rootOf } from '../tree/paths.ts'

import type { Copied } from '@/lib/copy.ts'
import { Button } from '@/components/ui/button.tsx'
import { RowMenu, type MenuAt } from '@/view/menu.tsx'
import { ROW_HEIGHT, TreeRow, type RowActions } from '@/view/row.tsx'
import { Empty, Listening, NoProject, Trouble } from '@/view/screens.tsx'
import { useTree } from '@/use-tree.ts'
import { useRoadmap, type GotoHandler } from '@/wire/use-roadmap.ts'

/**
 * The tallest frame this container will ever ask a host for, and the strip below
 * the rows that is not rows.
 *
 * Every sibling module measures its content and asks for exactly that. A tree
 * cannot: a project expanded three levels is four thousand rows, and asking for
 * an 88,000-pixel frame is asking a host to do something absurd on behalf of a
 * container in the corner of a canvas. So it asks for what it would like up to
 * this, and scrolls internally past it — the arrangement a sidebar has, and the
 * reason `page/document.ts` makes the body a fixed-height non-scrolling box.
 */
const MOST_WE_WILL_ASK_FOR = 420
/** The control row at the bottom, which is 24 tall plus its border and padding. */
const CHROME = 28

/**
 * The page.
 *
 * ## What it shows, and the one thing it does
 *
 * The working tree of whatever project the host says is open, rooted at
 * `context.projectPath`, read one directory at a time. There is no project
 * picker and no path box, deliberately: a second answer to "which project are we
 * in" is a container that can disagree with every other container on the canvas,
 * and a tree of the wrong project looks exactly like a tree of the right one.
 *
 * The one thing it does is point. Pressing a file publishes a `passage.set`
 * naming that file with no byte range, and paper, notes and diff all follow the
 * canvas passage — so a press here moves them. That is this module's reason to
 * exist beside the others rather than as a nicer `ls`.
 *
 * The bound on that press is in `manifest.ts` and in `wire/use-roadmap.ts`, and
 * it is worth one line here because this is where it would be broken: **the
 * only call to `point` in this file is inside a press handler.** Not in an
 * effect, not when a listing arrives, not on mount.
 *
 * ## Two techniques from VS Code, and this file is the second one
 *
 * `tree/flatten.ts` is the flattened visible-node model. This is the
 * virtualization over it: `@tanstack/react-virtual` keeps only the rows in view
 * in the DOM, which is what makes a directory of four thousand entries cost the
 * same as a directory of twelve.
 *
 * It is used unconditionally rather than above some row count. A branch that
 * rendered small trees plainly and large trees virtually would mean the code
 * path that runs on every real project is the one nobody tests by hand, and the
 * saving on the plain path is a few dozen divs. One path, always exercised.
 *
 * ## Height is measured, never assumed
 *
 * A virtualized list needs a scroll container with a real height, and this
 * container can be 150 pixels tall or 900. The iframe's viewport is not
 * something a module can rely on for that — the host sizes the frame, and what
 * the page sees depends on how it did it — so nothing here assumes a height.
 * The scroll element measures itself, twice over: the virtualizer watches its
 * own rect, and a `ResizeObserver` below reports the number for the one
 * decision that needs it as a number.
 *
 * Which is also why height is not a container query. `container: inline-size`
 * says nothing about how tall anything is. Width still goes through container
 * queries, as everywhere else in this workspace.
 */
export function App() {
  /**
   * The one context menu, and which row it was opened on.
   *
   * At the page level rather than inside a row, because the rows are
   * virtualized: a menu owned by a row would be unmounted the instant that row
   * scrolled out of the DOM, which is not a hypothetical when a menu opens near
   * the bottom edge of a container this short. Null is closed.
   */
  const [menu, setMenu] = useState<MenuAt | null>(null)
  /**
   * A sentence shown only when a copy did NOT happen.
   *
   * Nothing is said when it worked, and that asymmetry is the design. A toast
   * on every success in a 220-pixel container is a line of chrome that appears
   * twice a minute and says what the person already knows; a copy that silently
   * does nothing is the exact complaint this menu was built to answer, and it
   * is the only outcome they cannot see for themselves.
   */
  const [notice, setNotice] = useState<string | null>(null)

  const onGoto = useCallback<GotoHandler>((message, answer) => {
    /* A `goto` may name an epic, a step, or a reference. This container draws a
       directory listing and none of those three is one — saying so quickly is
       what gets the reader the host's fallback instead of a twelve-second wait. */
    answer(
      false,
      message.ref
        ? 'This container shows the project’s files, so there is nothing here to walk to by reference.'
        : 'This container shows the project’s files, so there is nothing here to walk to by epic or step.',
    )
  }, [])

  const { where, projectPath, passage, resize, point } = useRoadmap(ID, onGoto)
  const { loaded, open, loading, trouble, cut, toggle, refresh } = useTree(projectPath)

  const view = useMemo(() => ({ loaded, open, loading }), [loaded, open, loading])
  const rows = useMemo(() => flatten(view), [view])
  const truncated = useMemo(() => {
    let total = 0
    for (const [path, count] of cut) {
      if (path === '' || open.has(path)) total += count
    }
    return total
  }, [cut, open])

  /**
   * Which row the canvas is pointed at, as a path relative to the project.
   *
   * The passage carries an absolute path, because that is what the protocol
   * asks for and the only spelling two modules can agree on without sharing a
   * root. Rows carry relative ones. So the comparison happens once, here,
   * rather than on every row — and it is a string comparison rather than a
   * realpath, because a page cannot realpath anything and a passage set by
   * another module is a claim rather than a fact. A file reached through a
   * symlink will not match, which is the correct amount of certainty for a
   * highlight.
   */
  const pointedAt = useMemo(() => {
    if (!passage || !projectPath) return null
    /* `rootOf` rather than a local trailing-slash rule, because `absoluteOf`
       below builds the other direction with the same function — and the one
       failure worth designing out here is the two of them disagreeing, which
       shows up as a file this app itself just pointed at refusing to mark
       itself. See `tree/paths.ts`. */
    const root = `${rootOf(projectPath)}/`
    return passage.path.startsWith(root) ? passage.path.slice(root.length) : null
  }, [passage, projectPath])

  const actions: RowActions = useMemo(
    () => ({
      toggle,
      /*
       * Pressing a file points the canvas at it, with NO byte range.
       *
       * `from`, `to` and `quoted` are null and empty because this module has
       * never opened the file and has nothing true to say about what is inside
       * it. The protocol names this exactly: a passage with a path and no range
       * means "a document is open and nothing within it is selected", which is
       * precisely what pressing a filename in a tree means.
       *
       * `page` is null for the same reason. A page number is something a reader
       * does to a document, and this container is not a reader.
       *
       * Null when nothing is framing this page — there is no canvas to point,
       * and the row disables itself rather than being silently inert.
       */
      point: where === 'hosted' && projectPath
        ? (path: string) => point({ path: absoluteOf(projectPath, path), page: null, from: null, to: null, quoted: '' })
        : null,
      /*
       * Opening the menu is a state change here and NOTHING else.
       *
       * Not a selection, and emphatically not a `passage.set`: the bound in
       * `manifest.ts` is that this app points when a person presses a row, and
       * a right-click is not a press. It is worth saying at this call site
       * because this is where somebody would "helpfully" add it.
       *
       * Offered whether or not there is a canvas to point, unlike `point`
       * above — a path is a true thing about the disk regardless of who is
       * framing this page, and the clipboard is not the host's to grant.
       */
      menu: (path, x, y, from) => setMenu({ path, x, y, from }),
    }),
    [toggle, point, where, projectPath],
  )

  /**
   * What to say about a copy, which is nothing unless it failed.
   *
   * `clipboard` and `textarea` are both successes and are deliberately not
   * distinguished on screen: which mechanism a browser allowed is this
   * program's business, and a person who wanted a path now has one. It is
   * distinguished in the RETURN VALUE so a probe can assert the fallback path
   * without inferring it from silence — see `lib/copy.ts` and `dev/copying.mjs`.
   */
  const onCopied = useCallback((result: Copied) => {
    setNotice(result === 'failed' ? 'Could not copy the path.' : null)
  }, [])

  /*
   * The notice clears itself after a few seconds.
   *
   * A failure that stays on screen forever becomes part of the furniture and
   * stops being read, and there is nothing to act on once it has been seen —
   * the remedy is to try again, which puts it back. Keyed on the sentence so a
   * second failure restarts the clock rather than inheriting the first one's.
   */
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  /* A new project is a new tree, and a menu still open over it would be
     offering the path of a file in the project nobody is looking at any more. */
  useEffect(() => setMenu(null), [projectPath])

  /*
   * The scroll container's height, measured.
   *
   * ## What this is NOT for
   *
   * Not for the virtualizer. `@tanstack/react-virtual` observes its own scroll
   * element's rect and recomputes when it changes, so the rows are correct at
   * any height without anybody telling it. Duplicating that here would be a
   * second opinion about one number.
   *
   * ## What it IS for
   *
   * Deciding whether to ask the host for a taller frame at all — see the
   * `resize` effect below. That decision needs the number rather than a
   * breakpoint, which is why it is a `ResizeObserver` and not a container
   * query: `container: inline-size` says nothing about how tall anything is,
   * and this container can be 150 pixels tall or 900.
   *
   * An observer rather than a read on mount, because the height that matters is
   * the one after somebody drags the container's edge, and a measurement taken
   * once at mount is the one number guaranteed to be stale.
   */
  const scroller = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [where, trouble, projectPath])

  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    /*
     * Eight rows of slack above and below the viewport.
     *
     * Not a guess: at 22 pixels a row, eight rows is 176 pixels of pre-rendered
     * content on each side, which covers a fast flick on a trackpad before the
     * next frame paints. Larger overscan is more DOM for no benefit, and zero
     * shows blank bands while scrolling.
     */
    overscan: 8,
  })

  /*
   * How tall this page would like its frame to be, asked for once per change in
   * the number of rows.
   *
   * CAPPED, and the cap is the interesting half. Every sibling module measures
   * its content and asks for exactly that height. A tree cannot: a project
   * expanded three levels is four thousand rows, and asking for an
   * 88,000-pixel frame is asking a host to do something absurd on behalf of a
   * container in the corner of a canvas. So this asks for what it would like up
   * to 420 pixels and scrolls internally past that — which is the same
   * arrangement a sidebar has, and the reason `page/document.ts` makes the body
   * a fixed-height non-scrolling box.
   *
   * The host clamps it and may ignore it entirely; that is the protocol.
   */
  useEffect(() => {
    if (!rows.length || !height) return
    const wanted = Math.min(rows.length * ROW_HEIGHT, MOST_WE_WILL_ASK_FOR)
    /* Asked for only when the room on screen is genuinely short of it. A
       container already tall enough does not need a message, and a page that
       sent one on every expansion would be asking a host to relayout the canvas
       every time somebody opened a folder. */
    if (height >= wanted) return
    resize(wanted + CHROME)
  }, [resize, rows.length, height])

  if (where === 'listening') return <Listening />
  if (!projectPath) return <NoProject unhosted={where === 'unhosted'} />
  if (trouble) return <Trouble said={trouble} />

  const readRoot = loaded.get('')
  /* Still reading the root: no screen at all rather than a spinner. It is one
     `readdir` and it is done in single-digit milliseconds; anything drawn here
     is a flash the person reads as a fault. */
  if (!readRoot) return <div className="p-3" data-testid="reading" />
  if (!rows.length) return <Empty />

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/*
       * The scroll container, and the only thing on this page that scrolls.
       *
       * `overflow-x` is not set to anything: the body cannot scroll sideways at
       * all (see `page/document.ts`) and every row truncates rather than
       * widening, so a horizontal overflow is prevented rather than hidden.
       * Setting `overflow-x: hidden` here would clip a row that had a bug in it
       * instead of letting the bug be visible in a test.
       */}
      <div ref={scroller} data-testid="scroller" className="min-h-0 min-w-0 flex-1 overflow-y-auto p-1 @sm/container:p-1.5">
        <div style={{ height: virtual.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index]
            if (!row) return null
            return (
              <div
                key={row.entry.path}
                data-index={item.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <TreeRow row={row} pointed={pointedAt === row.entry.path} actions={actions} />
              </div>
            )
          })}
        </div>
      </div>

      {/*
       * Two presses, and a count, on one line at the bottom.
       *
       * At the bottom rather than the top because the top of a short container
       * is the rows, and a control strip above them costs a row of the twelve
       * there are. The count is what stops the hiding from being silent — see
       * the essay in `tree/flatten.ts` for why hiding is the default at all.
       *
       * `refresh` says "refresh" and not "the tree may be stale". Whether it is
       * stale is not something this app knows, and a permanent warning about a
       * thing that is usually not true is a warning people stop reading.
       */}
      {/*
       * The names a directory had that the server would not send.
       *
       * `read.ts` caps one directory at 5,000 entries, which is a bound on what
       * gets serialised rather than a security fence — but a container that
       * drew 5,000 of 20,000 names with nothing saying so would be lying about
       * the disk in the one place somebody is looking to find out what is on
       * it. So it is said, above the controls, only when it happened.
       *
       * There is no press beside it and there should not be: "show the rest"
       * would be a request for a fifteen-megabyte listing to draw twelve rows
       * from. A directory that large is one to search rather than to browse.
       */}
      {/*
       * Said only when a copy failed, and said in the same strip the truncation
       * count uses so that nothing on this page ever moves the rows.
       *
       * `role="status"` because a person using a screen reader gets no other
       * signal at all: the visible failure of a copy is that a paste later
       * produces the wrong thing, which is far too late to be told.
       */}
      {notice ? (
        <p
          data-testid="notice"
          role="status"
          className="min-w-0 shrink-0 border-t px-1.5 py-0.5 text-[0.65rem] text-red-600 dark:text-red-400"
        >
          {notice}
        </p>
      ) : null}

      {truncated ? (
        <p data-testid="truncated" className="min-w-0 shrink-0 border-t px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
          {truncated.toLocaleString()} more here than this shows.
        </p>
      ) : null}

      <div className="flex min-w-0 shrink-0 items-center gap-1 border-t px-1 py-0.5">
        <Button size="container" variant="ghost" data-testid="refresh" onClick={refresh}>
          refresh
        </Button>
      </div>

      {/*
       * The menu, drawn last and positioned against the frame's viewport rather
       * than against anything on this page.
       *
       * Last in the DOM so it paints over the rows without needing a stacking
       * context of its own, and outside the scroller so that scrolling cannot
       * clip it — a menu opened on the last visible row is taller than the room
       * left below it, and inside an `overflow-y: auto` box it would be cut in
       * half. Where it actually lands is `view/place.ts`, which is a pure
       * function with the 220-pixel cases in its tests.
       *
       * Only ever rendered with a `projectPath`, because an absolute path
       * without a root is not a path this app could spell honestly. The screens
       * above return before here when there is none, so this is a guard for the
       * type rather than a state anybody reaches.
       */}
      {menu && projectPath ? (
        <RowMenu at={menu} projectPath={projectPath} onCopied={onCopied} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  )
}
