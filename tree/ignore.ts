/**
 * What git would ignore, worked out here rather than asked.
 *
 * ## Why not `git check-ignore`
 *
 * It is the correct answer by definition: it is git, so it agrees with git
 * about every corner of the syntax, including the ones below that this file
 * does not implement. It was rejected for three reasons and the third is the
 * deciding one.
 *
 *   1. It is a subprocess per directory read. A person opening six folders is
 *      six `fork`/`exec` pairs, on the interaction path, in a container that is
 *      supposed to feel like a sidebar.
 *   2. It needs git on the machine and the directory to be a repository. A
 *      project that is not one — a folder somebody pointed the canvas at — would
 *      get an error where the honest answer is "nothing is ignored here".
 *   3. **It cannot be tested without a repository.** The ignore rules are the
 *      part of this module most likely to be quietly wrong, and a pure function
 *      over a string is a thing a test can attack from forty directions in a
 *      millisecond. That is worth more than agreeing with git about `[a-z]`
 *      character classes.
 *
 * ## So this is a subset, and the subset is written down
 *
 * Supported: comments, blank lines, `!` negation, trailing `/` for
 * directory-only, a leading or interior `/` for anchoring to the file's own
 * directory, `*`, `?`, `**`, character classes, and trailing-space stripping
 * with `\ ` as the escape. Last matching pattern wins, which is git's rule and
 * the one everything else depends on.
 *
 * **Not supported, deliberately:** `.git/info/exclude`, `core.excludesFile`,
 * `.gitattributes`, the index (so a file that is TRACKED but matches an ignore
 * pattern is reported ignored here and is not by git), and `\` escaping of
 * anything but a trailing space. Each of those needs either the repository's
 * own state or a config file outside the tree, and reaching for them is how a
 * tree module acquires a git implementation. The consequence of every one of
 * them is the same and it is small: a name is greyed, or hidden behind a
 * toggle, that git would have shown. Nothing is deleted, nothing is hidden
 * without a way to see it, and the toggle is one press.
 *
 * ## The one rule that is not a pattern
 *
 * A file inside an ignored DIRECTORY is ignored, and git will not let a
 * negation inside that directory bring it back — "it is not possible to
 * re-include a file if a parent directory of that file is excluded". That is
 * not expressible as a pattern match on a path, so it is not one: `read.ts`
 * passes each directory's own verdict down to its children, and this file never
 * sees the question. Getting it wrong the other way would mean walking into an
 * ignored `node_modules` to check whether something inside it was un-ignored,
 * which is the one walk this module must never do.
 */

/** One line of a `.gitignore`, compiled. */
export interface Rule {
  /** A `!` line: a match here un-ignores rather than ignores. */
  negate: boolean
  /** A trailing `/`: matches directories only. */
  dirOnly: boolean
  /** What the pattern matches, against a path relative to the file's own directory. */
  re: RegExp
  /** Kept for tests and for anybody reading a rule in a debugger. */
  source: string
}

/**
 * Compile one `.gitignore`'s worth of text.
 *
 * Order is preserved and matters: the LAST rule that matches decides, which is
 * why `ignoredBy` walks the array backwards rather than looking for any match.
 */
export function parseIgnore(text: string): Rule[] {
  const rules: Rule[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = strip(raw)
    if (!line || line.startsWith('#')) continue

    let pattern = line
    let negate = false
    if (pattern.startsWith('!')) {
      negate = true
      pattern = pattern.slice(1)
    }
    /* `\#` and `\!` are literal first characters, which is the only escaping
       git does at the front of a line. */
    else if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) {
      pattern = pattern.slice(1)
    }
    if (!pattern) continue

    let dirOnly = false
    if (pattern.endsWith('/')) {
      dirOnly = true
      pattern = pattern.slice(0, -1)
    }
    if (!pattern) continue

    /*
     * Anchoring. A pattern with a slash anywhere but at the very end is
     * relative to the `.gitignore`'s own directory; one without is a name that
     * matches at any depth. `dist` hides every `dist` in the tree and `/dist`
     * hides exactly one — a distinction people rely on and the single most
     * common way a hand-rolled matcher is wrong.
     */
    const anchored = pattern.includes('/')
    if (pattern.startsWith('/')) pattern = pattern.slice(1)
    if (!pattern) continue

    rules.push({
      negate,
      dirOnly,
      re: compile(pattern, anchored),
      source: line,
    })
  }
  return rules
}

/**
 * Trailing whitespace goes, unless the last space was escaped.
 *
 * Rare and real: `foo\ ` is a file whose name ends in a space, and stripping it
 * silently changes which file the line is about.
 */
function strip(line: string): string {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) {
    if (line[end - 2] === '\\') break
    end -= 1
  }
  return line.slice(0, end).replace(/\\ $/, ' ')
}

/**
 * A glob to a regular expression, with `/` treated as a real boundary.
 *
 * The three cases that are not "escape it and move on":
 *
 * - `**` between slashes eats any number of directories INCLUDING none, which
 *   is why `a/**\/b` has to match `a/b`. Written as an optional group rather
 *   than `.*`, because `.*` there requires a slash that is not present.
 * - `*` stops at a separator. A single star that crossed directories would make
 *   `*.log` match `deep/nested/x.log` from an anchored rule, which git does not.
 * - a character class is passed through with its contents escaped only for
 *   regex metacharacters that mean something different inside one.
 */
function compile(pattern: string, anchored: boolean): RegExp {
  let out = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*' && pattern[i + 1] === '*') {
      /* A double star followed by a separator: any number of leading
         directories, or none at all. */
      if (pattern[i + 2] === '/') {
        out += '(?:[^/]+/)*'
        i += 3
        continue
      }
      /* `/**` at the end, or a bare `**` — everything from here down. */
      out += '.*'
      i += 2
      continue
    }
    if (c === '*') {
      out += '[^/]*'
      i += 1
      continue
    }
    if (c === '?') {
      out += '[^/]'
      i += 1
      continue
    }
    if (c === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        out += '\\['
        i += 1
        continue
      }
      let body = pattern.slice(i + 1, close)
      /* git spells negation `[!abc]`; a regular expression spells it `[^abc]`. */
      if (body.startsWith('!')) body = `^${body.slice(1)}`
      out += `[${body.replace(/\\/g, '\\\\')}]`
      i = close + 1
      continue
    }
    /* `a/**` should also match `a/` itself's descendants without a doubled
       slash; the `**` branch above handles the interior case and this is the
       ordinary separator. */
    out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    i += 1
  }

  /*
   * Anchored patterns match from the start of the relative path. Unanchored
   * ones match a whole path SEGMENT anywhere, which is an optional
   * any-directories group in front — and it has to be the whole segment, or
   * `dist` would match `redistribute`.
   *
   * Both match the entry AND everything under it, which is what the trailing
   * optional-descendants group is for. `node_modules` ignoring `node_modules/react/index.js` is the whole
   * behaviour; without the tail every path would have to be tested against
   * every one of its own ancestors by the caller.
   */
  const head = anchored ? '^' : '^(?:.*/)?'
  return new RegExp(`${head}${out}(?:/.*)?$`)
}

/**
 * Whether these rules ignore this path, or `null` for "they say nothing".
 *
 * Three-valued rather than boolean, because a negation is not the same as
 * silence: a `.gitignore` in a subdirectory saying `!keep.txt` has to be able
 * to override the root's `*.txt`, and it can only do that if "explicitly not
 * ignored" is a value that travels. A boolean collapses it into the same
 * `false` as "no rule mentioned this", and then the outer file's verdict wins
 * over the inner one, which is backwards.
 *
 * Backwards through the array, because the last matching rule decides and the
 * first one found walking backwards IS the last one.
 */
export function ignoredBy(rules: readonly Rule[], relative: string, isDir: boolean): boolean | null {
  for (let i = rules.length - 1; i >= 0; i -= 1) {
    const rule = rules[i]!
    if (rule.dirOnly && !isDir) continue
    if (rule.re.test(relative)) return !rule.negate
  }
  return null
}

/**
 * The verdict from a whole chain of `.gitignore` files, outermost first.
 *
 * Innermost wins, which is git's rule and the reason this walks the chain
 * backwards too: a `.gitignore` deeper in the tree is more specific than the
 * root's and overrides it in both directions.
 *
 * Each level is asked about the path relative to ITS OWN directory, which is
 * what `at` carries — a rule written `/dist` in `packages/web/.gitignore` means
 * `packages/web/dist` and nothing else, and testing it against a root-relative
 * path would silently make it mean the root's.
 */
export interface Level {
  /** Directory the file was found in, relative to the root; `''` at the top. */
  at: string
  rules: Rule[]
}

export function verdict(chain: readonly Level[], relative: string, isDir: boolean): boolean {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const level = chain[i]!
    if (level.at && !relative.startsWith(`${level.at}/`)) continue
    const local = level.at ? relative.slice(level.at.length + 1) : relative
    const said = ignoredBy(level.rules, local, isDir)
    if (said !== null) return said
  }
  return false
}

/**
 * The name this module refuses to descend into under any configuration, and it
 * is not an ignore rule.
 *
 * `.git` is not "ignored" — git does not ignore it, it simply is not part of
 * the working tree — and it is not something a person browsing their project
 * ever wants forty rows of. It holds every object in the repository's history,
 * which is both an enormous number of files and, in `.git/config`, credentials
 * on some machines. So it is not listed, not expandable, and not reachable
 * through the toggle that reveals ignored names, because it is not behind that
 * toggle: it is not in the answer at all.
 *
 * A bare word rather than a pattern, matched on the segment name, so a file
 * legitimately called `.gitignore` or a directory called `.github` is unaffected.
 */
export const NEVER = new Set(['.git'])
