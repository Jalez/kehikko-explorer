import { KEHIKOT_DIR, type Anchor, type EpicPart } from 'kehikot-module-protocol'

/**
 * The tree, narrowed to the parts of the epic a person picked out.
 *
 * ## One rule, and it is not this file's
 *
 * A part has documents: paths relative to the project, whichever program keeps
 * them. Every row of this tree is a path relative to the project, so every row
 * can say what ties it to a part — `anchorOf` — and the protocol's
 * `useFocus(context).narrow` decides what is drawn. Nothing here compares a
 * path with the pick.
 *
 *  - **Nothing picked is the whole tree**, exactly as it was.
 *  - **A file** is about itself.
 *  - **A folder is shown when something in it is.** A folder is not a document
 *    and no part lists one, so it is about every document of the epic that
 *    lies under it. The tree is read one directory at a time, so this cannot
 *    be asked of the folder's rows — most of them have never been read — and
 *    is asked of the parts instead: they say which documents exist.
 *  - **What is in hand is kept** (`inHand`): the file the canvas is pointed
 *    at, the folders it sits in, and the row a menu is open on.
 *  - **One sentence, and only in a tree the pick left with no row**: the
 *    protocol's `No file is in the picked part.` Nothing is drawn about the
 *    pick while any row is.
 *
 * ## A host that sends `files` instead
 *
 * A host from before documents sends each part's files relative to one
 * folder under `.kehikot/`, and does not say which. The protocol reads both
 * spellings for a FILE — a `{ file }` anchor with the row's own path matches
 * either — so a file needs nothing more. A folder does: it has to name
 * something under itself that the protocol will recognise. So for each of
 * those names it offers the places the name could be under this folder, and
 * the protocol accepts the one that is right and refuses the rest. This file
 * never learns which folder it was.
 *
 * ## What this does not touch
 *
 * The MCP door. An agent has no canvas and no pick; `tree` answers about the
 * whole project whatever is picked.
 */

/** What one row is called in the protocol's sentence for an empty view. */
export const NOUN = 'file'

/** As much of a row as an anchor reads. */
export interface Anchored {
  /** Relative to the project, `/` between segments. */
  path: string
  kind: 'dir' | 'file'
}

/** What the epic's parts hold, picked or not: what a folder can be about. */
export interface Held {
  /** Every part's documents, once each, project-relative. */
  documents: readonly string[]
  /** Every part's names from a host older than documents, once each. */
  files: readonly string[]
  epic: string | null
}

const NOTHING: Held = { documents: [], files: [], epic: null }

/** Every document the epic's parts list — of all of them, since which are picked is the rule's question and not this file's. */
export function heldBy(parts: readonly EpicPart[] | null | undefined, epic?: string | null): Held {
  if (!parts?.length) return NOTHING
  const documents: string[] = []
  const files: string[] = []
  for (const part of parts) {
    for (const document of part.documents ?? []) if (!documents.includes(document)) documents.push(document)
    for (const file of part.files ?? []) if (!files.includes(file)) files.push(file)
  }
  return { documents, files, epic: epic ?? null }
}

/** `a/b/c.tex` as `a/b/c.tex`, `b/c.tex`, `c.tex`: what is left of a name below each folder it passes through. */
function tails(name: string): string[] {
  const segments = name.split('/')
  return segments.map((_, i) => segments.slice(i).join('/'))
}

/**
 * What ties one row to a part: THE anchor function of this module.
 *
 * A file: its own path. A folder: every document of the epic under it — and,
 * for a host that names files without saying where they are kept, each place
 * under this folder such a name could be (see "A host that sends `files`").
 * The root of `.kehikot` holds all of those wherever they are, so there the
 * name is offered as it came.
 */
export function anchorOf(row: Anchored, held: Held): Anchor[] {
  if (row.kind === 'file') return [{ file: row.path }]
  const under = `${row.path}/`
  const out: Anchor[] = []
  for (const document of held.documents) if (document.startsWith(under)) out.push({ file: document })
  if (row.path === KEHIKOT_DIR) {
    for (const file of held.files) out.push({ file })
  } else if (under.startsWith(`${KEHIKOT_DIR}/`)) {
    for (const file of held.files) {
      if (held.epic) out.push({ file: `${under}${held.epic}/${file}` })
      for (const tail of tails(file)) out.push({ file: `${under}${tail}` })
    }
  }
  return out
}

/**
 * Whether a row is in a person's hands, and so drawn whatever is picked.
 *
 * `pointed` is the file the canvas is pointed at, as this tree spells it; the
 * folders above it are in hand with it, or the row would have nowhere to be
 * drawn. `menu` is the row a menu is open on.
 */
export function inHand(path: string, pointed: string | null, menu: string | null = null): boolean {
  for (const held of [pointed, menu]) {
    if (held !== null && (held === path || held.startsWith(`${path}/`))) return true
  }
  return false
}
