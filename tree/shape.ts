/**
 * What an entry IS, and every bound this app puts on one.
 *
 * Shapes and numbers only — no filesystem, no React — because the server and
 * the page both work in these and a second definition of "an entry" is two
 * programs that agree until the day they do not.
 */

/** One thing in a directory, as this app is willing to describe it. */
export interface Entry {
  /**
   * Where it is, relative to the root, with `/` separators and no leading one.
   * The root itself is `''`.
   *
   * Relative rather than absolute for one reason worth the awkwardness: an
   * absolute path in every row is the project's location on somebody's disk
   * printed a hundred times into a container 220 pixels wide, and it is also
   * the answer to "what is under this root" carrying the root in it. The page
   * joins it back onto the root when it points the canvas, which is the one
   * place an absolute path is what the protocol asks for.
   *
   * POSIX separators on every platform, so the string a test writes and the
   * string a browser compares are the same string.
   */
  path: string
  /** The last segment, which is what a row draws. */
  name: string
  kind: 'dir' | 'file'
  /**
   * Whether git would ignore it — see `ignore.ts`.
   *
   * A property of the entry rather than a filter applied to the list, because
   * the page decides what to do about it and the two possible decisions (hide,
   * or grey) need the same field. Sending a pre-filtered list would make the
   * "show ignored" toggle a second request for the same directory.
   */
  ignored: boolean
  /**
   * Whether the name is a symlink.
   *
   * Drawn, because a symlink is a different kind of thing from the file it
   * names and a tree that hides that is a tree somebody will be surprised by. A
   * symlinked directory whose target leaves the root is reported as a `file`,
   * which is this app saying the only true thing it can: there is a name here,
   * and there is nothing under it that you may look at.
   */
  link: boolean
}

/**
 * The bounds, each with the failure it prevents.
 *
 * Every one of these is enforced at the door in `doors.ts` before anything
 * touches disk, because the caller is whatever on this machine found the port —
 * loopback is a fence around the machine and not around the programs on it.
 */

/** A path in a request. The protocol's own `LIMITS.PATH` is 4096; this matches it. */
export const MAX_PATH = 4096

/**
 * How many entries one directory may report.
 *
 * `node_modules` in a large project is tens of thousands of names, and a
 * `readdir` of it is one syscall that returns all of them. The cap is on what
 * this app will SERIALISE and send, and it is not a security bound — it is the
 * difference between a container that draws a long list and a page that
 * receives a fifteen-megabyte JSON document to draw twelve rows from. Over the
 * cap the answer says so, in a row of its own, rather than truncating silently.
 */
export const MAX_ENTRIES = 5000

/**
 * How deep an MCP caller may ask for at once, and how many entries the whole
 * answer may contain.
 *
 * The page never uses these: it reads one directory at a time, because that is
 * what a person expanding a folder is. An agent has a different question — "what
 * is the shape of this project" — and answering it one round trip per directory
 * is a conversation nobody wants. So depth exists at `/mcp` and nowhere else,
 * it defaults to shallow, and it is capped rather than trusted: a recursive walk
 * of a repository with a `node_modules` in it is minutes of IO and a document
 * no agent can read.
 */
export const MAX_DEPTH = 5
export const MAX_WALK = 2000

/** A string argument, bounded, or `''`. Nothing here defaults a missing value into a real one. */
export function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > max ? '' : trimmed
}

/**
 * A whole number in range, or null.
 *
 * Null rather than a default, so the caller decides what a missing depth means
 * and a malformed one is never silently read as the default. `"3"` is accepted
 * because a query string has no numbers in it.
 */
export function count(value: unknown, max: number): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isInteger(n) || n < 0 || n > max) return null
  return n
}
