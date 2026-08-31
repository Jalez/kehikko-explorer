import type { Entry } from './shape.ts'

/**
 * The flattened visible-node model, which is the whole reason this module is
 * fast on a repository somebody actually has.
 *
 * ## What was borrowed from VS Code, and what could not be
 *
 * The owner asked which library VS Code builds its Explorer on. There is not
 * one that can be installed: it is `AsyncDataTree` over `vs/base/browser/ui/tree`
 * and `.../list`, internal to that codebase and never published. What transfers
 * is not code, it is two techniques, and this file is the first of them.
 *
 * A tree on screen is not a tree. It is a LIST — the rows currently visible,
 * top to bottom — and the nested structure exists only to compute that list.
 * So the nesting is kept as it comes off disk (a map of directory to its
 * children, filled in as things are opened) and the thing React renders is a
 * flat array recomputed whenever an expansion changes. The second technique,
 * virtualization, then only has to keep the rows in view in the DOM, and it can
 * only do that because it is handed an array with an index and a known row
 * height rather than a shape it would have to walk.
 *
 * ## Why this is a pure function in a file of its own
 *
 * Because it is the part that is easy to get subtly wrong and impossible to see
 * wrong. An off-by-one in a depth, a child list attached under the wrong key, a
 * collapsed directory whose descendants are still in the array — every one of
 * those draws a plausible tree. So it takes four plain values and returns an
 * array, it touches no state and no DOM, and `test/flatten.test.ts` is the
 * longest test file in this repository.
 *
 * ## Iterative, not recursive
 *
 * A recursive walk over a tree the user built by expanding is bounded by how
 * many times somebody pressed a folder, so it would not actually blow a stack.
 * It is iterative anyway, because the interesting bound is not depth: a
 * symlinked directory inside the root that points at one of its own ancestors
 * is legal, expandable, and infinitely deep, and a person can walk into it by
 * hand. An explicit stack with a depth cap says no in one line; recursion says
 * no by crashing the page.
 */

/** One visible line. Everything a row needs to draw itself, and nothing else. */
export interface Row {
  entry: Entry
  /** How far in, in levels. The root's own children are 0. */
  depth: number
  /** A directory that is open. Always false for a file. */
  open: boolean
  /** A directory whose children have been asked for and have not arrived. */
  loading: boolean
  /** A directory that is open, has answered, and had nothing to show. */
  empty: boolean
}

/** What `flatten` needs to know, gathered so the signature stays readable. */
export interface View {
  /** Children by directory path, `''` for the root. Absent means never asked. */
  loaded: ReadonlyMap<string, readonly Entry[]>
  /** Directory paths the person has opened. */
  open: ReadonlySet<string>
  /** Directory paths whose read is in flight. */
  loading: ReadonlySet<string>
  /** Whether names git ignores are drawn at all. See `app.tsx` for why this is a toggle. */
}

/**
 * How deep this will go before it stops.
 *
 * Not a limit on projects — nobody has a source tree sixty-four levels deep —
 * but on the cycle a symlink can make. See the note on recursion above.
 */
const MAX_DEPTH = 64

/**
 * The visible rows, top to bottom.
 *
 * Order is the order `read.ts` sorted the entries into, which is directories
 * first and then names: the sort happens once on the server, and re-sorting
 * here would be a second opinion about the same list that could disagree with
 * the first after an edit to either.
 */
export function flatten(view: View): Row[] {
  const rows: Row[] = []

  /*
   * The stack holds SIBLINGS AND AN INDEX rather than a queue of nodes, and the
   * difference is the whole reason this produces a tree rather than a heap.
   *
   * The obvious version — push a node's children onto a stack and pop — emits
   * every child of the current directory before descending into the first of
   * them, which draws all the directories at one level and then all their
   * contents. That looks almost right on a shallow tree and is unmistakably
   * wrong the moment two folders at one level are both open. Carrying the
   * position within each sibling list is what keeps depth-first order.
   */
  const stack: { entries: readonly Entry[]; at: number; depth: number }[] = [
    { entries: visible(view.loaded.get('') ?? []), at: 0, depth: 0 },
  ]

  while (stack.length) {
    const frame = stack[stack.length - 1]!
    if (frame.at >= frame.entries.length) {
      stack.pop()
      continue
    }
    const entry = frame.entries[frame.at]!
    frame.at += 1

    const isDir = entry.kind === 'dir'
    const open = isDir && view.open.has(entry.path)
    const children = open ? view.loaded.get(entry.path) : undefined
    const loading = isDir && view.loading.has(entry.path)

    rows.push({
      entry,
      depth: frame.depth,
      open,
      loading,
      /*
       * `empty` distinguishes the two states an open folder with no rows under
       * it can be in, and they need different words on screen: one is still
       * reading and one has read. A container that drew them the same way would
       * show a folder that is permanently about to say something.
       *
       * A directory whose only contents are ignored, with the toggle off, is
       * empty by this definition and that is correct — it is empty of what this
       * container is showing, and the toggle is right there.
       */
      empty: open && children !== undefined && visible(children).length === 0,
    })

    if (open && children && frame.depth + 1 < MAX_DEPTH) {
      stack.push({ entries: visible(children), at: 0, depth: frame.depth + 1 })
    }
  }

  return rows
}

/**
 * Everything a directory holds, because hiding some of it was the wrong answer.
 *
 * This used to filter ignored entries out behind a toggle, on the argument that
 * a twelve-row container cannot afford a JavaScript project's ignored set. The
 * owner's response to the toggle was "I don't understand the point of that at
 * all", and on reflection neither do I: the toggle asked a person to decide, on
 * every project, a question they had no reason to have an opinion about, and it
 * spent a row of a 220px container asking it.
 *
 * VS Code's answer was already sitting in this file's own comment two
 * paragraphs up: ignored files are SHOWN, and shown greyed, because a person
 * looking at a project wants to see what is in it and wants to be able to tell
 * what git will not carry. `row.tsx` already draws them in
 * `text-muted-foreground`; that greying was doing the whole job and the toggle
 * was hiding the rows it was meant to distinguish.
 *
 * What made the old worry real was `node_modules`, and that is answered
 * elsewhere and better: nothing walks into a directory nobody expanded, so an
 * ignored folder costs exactly one row until somebody asks for more. `.git` is
 * refused outright rather than ignored, and `.kehikot` is never treated as
 * ignored at all — this workspace's own folder, in this workspace's own
 * explorer.
 *
 * Kept as a function rather than inlined so the argument has somewhere to live.
 */
function visible(entries: readonly Entry[]): Entry[] {
  return entries as Entry[]
}

