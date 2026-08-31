import { ChevronRight } from 'lucide-react'

import type { Row } from '../../tree/flatten.ts'

import { cn } from '@/lib/utils.ts'

/**
 * One line of the tree.
 *
 * ## The height is a constant that CSS also knows
 *
 * A virtualized list needs every row to be the same height and needs to know
 * the number before anything is rendered — that is how it decides which rows
 * exist at all. So the number lives here as a constant and in `index.css` as
 * `--row`, and the two must not drift: a disagreement is not a visual bug, it
 * is rows that overlap or gaps that open as you scroll, and it reads as a
 * rendering fault rather than as a wrong constant. There is a test asserting
 * they are the same.
 *
 * 22 pixels, which is small. The reason is in `index.css`: this container is
 * routinely under 300 pixels tall, and at a comfortable 32 that is nine rows.
 * The compensation is that the press target spans the full width, so it is a
 * wide target rather than a tall one.
 *
 * ## What is NOT on a row
 *
 * No file-type icon, no size, no modified time, no git status.
 *
 * The icon is the interesting omission. A folder icon beside a chevron beside a
 * name is three things competing in a column 220 pixels wide, and the chevron
 * already says which rows are folders — it is present on exactly the directories
 * and absent on exactly the files. So the chevron's own width doubles as the
 * indent unit, files get a blank of the same width to keep the names aligned,
 * and the fourteen pixels that a second icon would have cost go to the name,
 * which is the only thing on this row anybody is reading.
 *
 * Size and modified time were never in question: they are two more columns in
 * the narrowest container on the canvas, answering questions a person browsing
 * a project is not asking. Git status was, and is a genuinely good feature that
 * belongs to the module beside this one — the diff module knows what changed
 * and this one does not, and two containers disagreeing about which files are
 * modified is worse than one of them staying quiet.
 */
export const ROW_HEIGHT = 22

export interface RowActions {
  /** Open or close a directory. */
  toggle: (path: string) => void
  /** Point the canvas at a file. Null when nothing is framing this page. */
  point: ((path: string) => void) | null
}

export function TreeRow({
  row,
  pointed,
  actions,
}: {
  row: Row
  /** Whether the canvas is currently pointed at this file. */
  pointed: boolean
  actions: RowActions
}) {
  const { entry, depth, open, loading, empty } = row
  const isDir = entry.kind === 'dir'

  /*
   * Indentation is a `paddingLeft` rather than nested elements, because the
   * rows are a flat array — that is the whole design, see `tree/flatten.ts` —
   * and nesting them would put the structure back in the DOM that the flat
   * model exists to keep out of it.
   *
   * Capped, because indentation is the one thing on a row that can push the
   * name off the edge. Ten levels at 10 pixels is a hundred pixels of a
   * 220-pixel container spent on whitespace, and past that a deeper file just
   * stops moving right. The tree is still readable because the chevrons still
   * line up per level up to the cap, and a name that would otherwise be
   * invisible is worth more than an exact depth nobody is measuring.
   */
  const indent = Math.min(depth, 10) * 10

  return (
    <div
      className={cn(
        'flex w-full min-w-0 select-none items-center rounded-sm pr-1 text-left text-xs',
        'hover:bg-accent hover:text-accent-foreground',
        pointed && 'bg-pointed text-pointed-foreground hover:bg-pointed hover:text-pointed-foreground',
        /* Ignored names are greyed rather than hidden ONCE THEY ARE SHOWN, which
           is VS Code's answer and the right one at that point: the person asked
           to see them and now needs to tell them apart. The decision to hide
           them by default is a different one and is argued in `flatten.ts`. */
        entry.ignored && !pointed && 'text-muted-foreground',
      )}
      style={{ height: ROW_HEIGHT, paddingLeft: indent }}
    >
      {/*
       * The chevron is its own press, and the name is another.
       *
       * On a directory both do the same thing, which looks redundant and is
       * not: the chevron is a 16-pixel target and the row is the whole width,
       * and a person aiming at a folder aims at its name. Keeping them as two
       * buttons rather than one is what lets a FILE row have a chevron-shaped
       * blank without it being pressable.
       */}
      {isDir ? (
        <button
          type="button"
          aria-label={open ? `close ${entry.name}` : `open ${entry.name}`}
          data-testid="chevron"
          className="flex size-4 shrink-0 items-center justify-center"
          onClick={() => actions.toggle(entry.path)}
        >
          <ChevronRight
            className={cn('size-3 transition-transform', open && 'rotate-90', loading && 'animate-pulse')}
            aria-hidden
          />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}

      {/*
       * `title` carries the whole path, because the name is truncated and a
       * truncated name in a narrow container is a name somebody cannot read. It is
       * the path relative to the project rather than the absolute one: the
       * absolute path is the same forty characters on every row, and the part
       * that differs is the part worth showing.
       */}
      <button
        type="button"
        title={entry.path}
        data-testid="row"
        data-path={entry.path}
        className="min-w-0 flex-1 truncate text-left"
        onClick={() => (isDir ? actions.toggle(entry.path) : actions.point?.(entry.path))}
        /* A file row does nothing at all when nothing is framing this page,
           because pointing the canvas is the only thing pressing a file does.
           Disabled rather than silently inert, so the cursor says so. */
        disabled={!isDir && !actions.point}
      >
        {entry.name}
        {/* A symlink says so, in one character, because a link and the thing it
            names are different kinds of thing and a tree that hides that is a
            tree somebody will be surprised by. */}
        {entry.link ? <span className="ml-1 opacity-60">@</span> : null}
      </button>

      {/*
       * "empty" is a word rather than nothing at all.
       *
       * An open folder with no rows under it and no word beside it is
       * indistinguishable from an open folder that is still reading, and the
       * second one resolves and the first one never does. This is the shortest
       * true sentence for the state.
       */}
      {empty ? <span className="ml-1 shrink-0 text-[0.65rem] opacity-60">empty</span> : null}
    </div>
  )
}
