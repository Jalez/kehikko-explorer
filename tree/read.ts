import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, posix } from 'node:path'

import { inside } from './confine.ts'
import { NEVER, parseIgnore, verdict, type Level } from './ignore.ts'
import { MAX_ENTRIES, MAX_WALK, type Entry } from './shape.ts'

/**
 * One directory, read once.
 *
 * ## Lazy is not an optimisation here, it is the design
 *
 * Nothing in this file ever recurses on its own. `list()` reads exactly the
 * directory it was asked about, and the only thing that reads a second one is a
 * person pressing a folder open or an agent naming a depth. That is the same
 * shape VS Code's Explorer has — its `AsyncDataTree` asks a data source for the
 * children of one node, when that node opens, and never before — and it is the
 * reason a repository with a hundred thousand files in `node_modules` costs
 * this app one `readdir` of the root.
 *
 * The failure it prevents is specific and this workspace has watched other
 * programs have it: a tree that walks eagerly spends thirty seconds and half a
 * gigabyte building an answer to a question nobody asked, and the symptom is a
 * container that is blank for half a minute and then correct, which reads as
 * broken rather than as slow.
 *
 * ## What one call costs
 *
 * One `readdir` with `withFileTypes`, then one `statSync` per symlink and no
 * stat at all for anything else — `Dirent` already knows a directory from a
 * file, and asking the kernel again for every name is how a listing of five
 * thousand entries becomes five thousand syscalls. Plus at most one small
 * `readFile` per `.gitignore` on the path from the root, cached below.
 *
 * ## Everything here is synchronous, on purpose
 *
 * The caller is a request handler on a single-connection loopback server, and
 * one `readdir` of one directory is sub-millisecond on anything but a cold
 * network mount. What asynchrony would buy is the ability to interleave two
 * reads that nobody is issuing concurrently; what it costs is that every path
 * through the confinement check becomes a place where the filesystem can change
 * under the check. The one thing this file cannot afford is a gap between "this
 * is inside the root" and "open it".
 */

/** What a read gives back: the entries, or a sentence saying why not. */
export type Listing =
  | { ok: true; path: string; entries: Entry[]; more: number }
  | { ok: false; error: string }

/**
 * The listing of `relative` under `root`.
 *
 * `root` must already have come through `rootOf`; `relative` is whatever a
 * caller sent and is confined here, every time, with no fast path for `''`.
 */
export function list(root: string, relative: string): Listing {
  const target = inside(root, relative)
  if (target === null) return { ok: false, error: NOT_HERE }

  const rel = normalise(relative)
  /*
   * `.git` is refused as a DESTINATION and not only dropped from listings, and
   * the difference is a hole this module had for exactly one test run.
   *
   * Filtering the name out of every listing means there is no row to press, and
   * that is enough for the page — but the page is not the only caller. An agent
   * at `/mcp`, or anything on this machine that found the port, can name a path
   * this app never offered, and `<root>/.git` is inside the root, so
   * confinement had nothing to say about it. The answer came back with
   * `config` in it, which on some machines holds credentials.
   *
   * So the refusal is on the path being asked about rather than on the names in
   * the answer, and it is checked SEGMENT BY SEGMENT: a directory that merely
   * starts with `.git` — `.github` — is unaffected, and `.git` anywhere in the
   * path is refused, including submodules deeper in the tree.
   */
  if (rel.split('/').some((segment) => NEVER.has(segment))) return { ok: false, error: NOT_HERE }
  /*
   * A file is a refusal rather than an empty list.
   *
   * An empty list is what an empty directory looks like, and a caller that
   * cannot tell "you asked about a file" from "that folder is empty" will draw
   * the second when the first is true — an expandable row that opens onto
   * nothing, forever, with no way to learn why.
   */
  let stats
  try {
    stats = statSync(target)
  } catch {
    return { ok: false, error: NOT_HERE }
  }
  if (!stats.isDirectory()) return { ok: false, error: 'That is a file. This module lists directories and never opens one.' }

  let names
  try {
    names = readdirSync(target, { withFileTypes: true })
  } catch {
    return { ok: false, error: 'That directory could not be read.' }
  }

  const chain = chainFor(root, rel)
  /*
   * The parent's own verdict, inherited by everything in it.
   *
   * git will not re-include a file whose parent directory is excluded, and the
   * reason this app has to agree is not pedantry: disagreeing means walking
   * INTO an ignored `node_modules` to find out whether something in it was
   * un-ignored. One flag passed down replaces that walk entirely.
   */
  const parentIgnored = rel === '' ? false : verdict(chain, rel, true)

  const entries: Entry[] = []
  let more = 0
  for (const dirent of names) {
    if (NEVER.has(dirent.name)) continue
    if (entries.length >= MAX_ENTRIES) {
      more += 1
      continue
    }
    const path = rel ? posix.join(rel, dirent.name) : dirent.name
    const link = dirent.isSymbolicLink()
    const kind = link ? linkKind(root, join(target, dirent.name)) : dirent.isDirectory() ? 'dir' : 'file'
    entries.push({
      path,
      name: dirent.name,
      kind,
      ignored: parentIgnored || verdict(chain, path, kind === 'dir'),
      link,
    })
  }

  return { ok: true, path: rel, entries: entries.sort(order), more }
}

/**
 * Directories first, then names, case-insensitively, with a stable tiebreak.
 *
 * VS Code's order, and it is the right one for a reason worth stating: a person
 * scanning a tree is looking for a place to go before they are looking for a
 * file, so the things you can go into belong at the top. `localeCompare` with
 * `numeric` so `chapter2` sorts before `chapter10`, which is what the numbers
 * in a filename were for.
 */
function order(a: Entry, b: Entry): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || (a.name < b.name ? -1 : 1)
}

/**
 * What a symlink counts as, which is the one case where the kind is a
 * judgement rather than a fact off the `Dirent`.
 *
 * Everything that is not a link is answered by `readdir` itself, and that is
 * used above: a `statSync` per entry is the difference between one syscall and
 * five thousand on a directory somebody is waiting for.
 *
 * A link has to be followed to be classified, and following it is opening a
 * path chosen by whatever wrote the link — so it is followed only through
 * `inside()`. A link whose target is a directory INSIDE the root is a directory
 * and may be opened; a link whose target is anywhere else is reported as a
 * file. That is not a lie by omission, because the row is marked as a link:
 * what it says is "there is a name here and nothing under it that you may look
 * at", which is exactly true.
 *
 * A broken link lands in the same place, since `inside()` refuses what it
 * cannot realpath, and that is the correct row — the name exists and there is
 * nothing behind it.
 */
function linkKind(root: string, absolute: string): 'dir' | 'file' {
  const target = inside(root, absolute)
  if (target === null) return 'file'
  try {
    return statSync(target).isDirectory() ? 'dir' : 'file'
  } catch {
    return 'file'
  }
}

/**
 * The `.gitignore` chain from the root down to `relative`, cached on mtime.
 *
 * Cached because a person opening six folders in one repository re-reads the
 * root's `.gitignore` six times otherwise, and it is the same forty lines every
 * time. Keyed on the file's mtime and size so that editing a `.gitignore` is
 * picked up on the next read rather than on the next restart — a stale ignore
 * list is a container hiding files that came back, which is the exact bug that
 * makes somebody stop believing a tree.
 *
 * A missing `.gitignore` is cached too, as an empty rule set, because "there is
 * no .gitignore here" is the common answer for every directory below the root
 * and re-asking the filesystem for it on every read is the cost this cache
 * exists to avoid.
 */
interface Cached {
  stamp: string
  level: Level
}
const cache = new Map<string, Cached>()

function chainFor(root: string, relative: string): Level[] {
  const chain: Level[] = []
  const parts = relative ? relative.split('/') : []
  for (let i = 0; i <= parts.length; i += 1) {
    const at = parts.slice(0, i).join('/')
    const level = levelAt(root, at)
    if (level) chain.push(level)
  }
  return chain
}

function levelAt(root: string, at: string): Level | null {
  const file = at ? join(root, at, '.gitignore') : join(root, '.gitignore')
  let stamp = 'none'
  try {
    const stats = statSync(file)
    stamp = `${stats.mtimeMs}:${stats.size}`
  } catch {
    /* No file. Cached as such — see the essay above. */
  }
  const key = `${root} ${at}`
  const hit = cache.get(key)
  if (hit && hit.stamp === stamp) return hit.level.rules.length ? hit.level : null

  let rules: ReturnType<typeof parseIgnore> = []
  if (stamp !== 'none') {
    try {
      rules = parseIgnore(readFileSync(file, 'utf8'))
    } catch {
      rules = []
    }
  }
  const level: Level = { at, rules }
  cache.set(key, { stamp, level })
  return rules.length ? level : null
}

/**
 * Several levels at once, for an agent rather than for the page.
 *
 * The page never calls this, and that is the important half: a person expanding
 * folders gets one `readdir` per press, forever, whatever this does. An agent
 * asking "what is the shape of this project" has a genuinely different question
 * and answering it one round trip per directory is a conversation.
 *
 * Bounded three ways, and each bound is the difference between an answer and an
 * incident: `depth` is capped by the caller's argument and by `MAX_DEPTH`,
 * total entries by `MAX_WALK`, and **an ignored directory is never descended
 * into at all.** That last one is what keeps `node_modules` out of a depth-5
 * walk of a JavaScript project — not a name check, but the same ignore rules
 * the person sees, which is why a project that genuinely tracks a vendored
 * directory still gets it walked.
 *
 * Breadth-first, so that a walk cut short by `MAX_WALK` has read the shallow
 * levels rather than one deep spur. A truncated answer that describes the top
 * of the tree is useful; one that describes `src/a/b/c/d` and nothing else is
 * not.
 */
export interface Walked {
  entries: Entry[]
  /** True when a bound stopped the walk, so the caller can say so rather than imply completeness. */
  cut: boolean
}

export function walk(root: string, relative: string, depth: number, withIgnored: boolean): Walked | { error: string } {
  const first = list(root, relative)
  if (!first.ok) return { error: first.error }

  const entries: Entry[] = []
  let cut = first.more > 0
  let frontier: Entry[] = first.entries.filter((one) => withIgnored || !one.ignored)
  entries.push(...frontier)

  for (let level = 1; level <= Math.min(depth, 5); level += 1) {
    const next: Entry[] = []
    for (const one of frontier) {
      if (one.kind !== 'dir') continue
      /* Never into an ignored directory, whatever the toggle says. Showing an
         ignored name is a row; walking one is a minute of IO. */
      if (one.ignored) continue
      if (entries.length >= MAX_WALK) {
        cut = true
        break
      }
      const under = list(root, one.path)
      if (!under.ok) continue
      if (under.more > 0) cut = true
      const kept = under.entries.filter((child) => withIgnored || !child.ignored)
      const room = MAX_WALK - entries.length
      if (kept.length > room) cut = true
      const taken = kept.slice(0, Math.max(room, 0))
      entries.push(...taken)
      next.push(...taken)
    }
    if (!next.length) break
    frontier = next
  }

  return { entries, cut }
}

/** POSIX separators, no leading slash, no `.`; the shape `Entry.path` promises. */
function normalise(relative: string): string {
  const cleaned = relative.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  return cleaned === '.' ? '' : cleaned
}

/**
 * One refusal, said one way.
 *
 * "Outside the root", "does not exist" and "cannot be read" are three facts and
 * one sentence, for the reason `confine.ts` gives: a caller that can tell them
 * apart can ask this app whether a file it may not see exists, one question at
 * a time. The sentence names the remedy a legitimate caller has, which is to
 * ask about something under the project they named.
 */
const NOT_HERE = 'There is nothing there to list inside this project.'

export { NOT_HERE }
