/**
 * How a row's path is SPELLED, in the two spellings anybody ever wants one in.
 *
 * ## Why this is a file rather than a template literal at the call site
 *
 * Because it was already a template literal at a call site, and it was about to
 * become three. `app.tsx` built `${projectPath.replace(/\/$/, '')}/${path}` to
 * put an absolute path in a passage; the context menu needs the same string to
 * put on the clipboard; and the day something else in here needs one, the
 * fourth copy is the one that forgets the trailing slash. Two containers on a
 * canvas disagreeing about how to spell the same file is not a cosmetic
 * difference — a passage that names `/home/x//src/a.ts` points nothing at
 * anything, and the row that would have matched it stays unmarked.
 *
 * So it is one function, it is pure, and `test/paths.test.ts` holds the edges.
 * That is the same arrangement `tree/flatten.ts` and `tree/ignore.ts` have and
 * for the same reason: every one of these mistakes produces a plausible string.
 *
 * ## What "relative" is relative TO, which is the question worth answering
 *
 * The project root the host named, in `context.projectPath` — the directory
 * this container is the explorer OF, and the only root it has. That is also
 * what VS Code's "Copy Relative Path" means (relative to the workspace folder),
 * so somebody arriving from there gets the string they expected.
 *
 * It is emphatically NOT relative to the directory the row happens to sit in,
 * and not relative to whatever the person's shell has as a working directory.
 * Both of those are spellings this app cannot produce honestly: it has never
 * seen a shell, and a path relative to a parent row is a string that means
 * something different depending on where it is pasted. A relative path is only
 * useful when the reader knows the base, and the project root is the one base
 * every container on this canvas already shares.
 *
 * The rows already carry exactly that spelling — `read.ts` produces paths
 * relative to the root and nothing here re-bases them — so `relative` is a
 * near-identity, and that is the point: the interesting work is in the one case
 * where it is not, below.
 */

/** A path, said both ways, so a caller never has to build the other one. */
export interface Spelling {
  /** The whole path from the filesystem root. What a passage carries and what a terminal wants. */
  absolute: string
  /** The path from the project root. What a commit message, an issue or a code review wants. */
  relative: string
}

/**
 * A row's path, absolute and relative.
 *
 * `projectPath` is the root the host named. `path` is the row's own path as the
 * server produced it: relative to that root, no leading slash, `/` separated.
 *
 * ## The root itself is `.` and not the empty string
 *
 * `path` is `''` for the root directory, because that is the key `useTree` uses
 * for the root's listing and the value `/api/tree` takes for it. No ROW is ever
 * the root — the flattened model starts at the root's children — so this case
 * only arises if something later grows a way to act on the root itself. It is
 * answered anyway, and answered with `.` rather than `''`, because an empty
 * string on a clipboard is a copy that silently did nothing, which is the exact
 * failure this whole menu exists to fix. `.` is what `git`, `ls` and every
 * shell already understand as "this directory", so it pastes usefully.
 *
 * ## Trailing slashes on the root are eaten, all of them
 *
 * A host may hand over `/home/me/project` or `/home/me/project/`, and both are
 * the same directory. `//` in the middle of a path is legal on POSIX and works,
 * which is worse than it failing: the string is subtly not equal to the one
 * every other container built, so `pointedAt`'s prefix comparison misses and a
 * row stops marking itself for a reason nobody can see on screen.
 *
 * The filesystem root is the exception and has to be, since `/` is entirely
 * trailing slash. Stripping it to `''` would turn `/etc` into `etc`, which is a
 * different file or no file at all.
 */
export function spell(projectPath: string, path: string): Spelling {
  const root = rootOf(projectPath)
  return {
    absolute: path ? (root === '/' ? `/${path}` : `${root}/${path}`) : root,
    relative: path || '.',
  }
}

/** The absolute spelling alone, for the callers that only ever want that one. */
export function absoluteOf(projectPath: string, path: string): string {
  return spell(projectPath, path).absolute
}

/**
 * The project root with its trailing slashes removed, `/` excepted.
 *
 * Separate from `spell` because the reverse direction needs it too: `app.tsx`
 * decides which row the canvas is pointed at by stripping `${root}/` off the
 * front of the passage's path, and if the two disagree about what the root's
 * spelling is then a file this app itself just pointed at fails to mark itself.
 * One function, so they cannot.
 */
export function rootOf(projectPath: string): string {
  const trimmed = projectPath.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}
