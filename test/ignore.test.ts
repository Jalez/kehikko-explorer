import { describe, expect, test } from 'bun:test'

import { NEVER, ignoredBy, parseIgnore, verdict, type Level } from '../tree/ignore.ts'

/**
 * The `.gitignore` subset, attacked from every direction the syntax has.
 *
 * These are pure functions over strings, which is the whole argument for not
 * shelling out to `git check-ignore` — see the essay at the top of
 * `tree/ignore.ts`. So the tests are cheap and there are a lot of them, and
 * each one names the behaviour rather than the implementation, so that a
 * rewrite of `compile` is checked rather than merely re-run.
 */

/** One `.gitignore` at the root, compiled. */
function at(text: string) {
  const rules = parseIgnore(text)
  return (path: string, isDir = false) => ignoredBy(rules, path, isDir)
}

describe('parsing', () => {
  test('blank lines and comments produce no rules', () => {
    expect(parseIgnore('\n\n# a comment\n   \n')).toEqual([])
  })

  test('a leading backslash makes # and ! literal', () => {
    const says = at('\\#notacomment\n\\!notanegation')
    expect(says('#notacomment')).toBe(true)
    expect(says('!notanegation')).toBe(true)
  })

  /* Trailing whitespace is stripped, which changes which file a line is about
     unless the space was escaped. Both directions are asserted because one of
     them is the surprising one. */
  test('trailing spaces are stripped unless escaped', () => {
    expect(at('dist   ')('dist')).toBe(true)
    const escaped = parseIgnore('ends\\ ')
    expect(escaped).toHaveLength(1)
    expect(escaped[0]!.source).toBe('ends ')
  })

  test('the source line is kept for a reader', () => {
    expect(parseIgnore('node_modules')[0]!.source).toBe('node_modules')
  })
})

describe('anchoring — the single most common way a matcher is wrong', () => {
  test('a pattern with no slash matches at any depth', () => {
    const says = at('dist')
    expect(says('dist')).toBe(true)
    expect(says('src/dist')).toBe(true)
    expect(says('a/b/c/dist')).toBe(true)
  })

  test('a leading slash anchors to the file’s own directory', () => {
    const says = at('/dist')
    expect(says('dist')).toBe(true)
    expect(says('src/dist')).toBeNull()
  })

  test('an interior slash anchors too', () => {
    const says = at('src/generated')
    expect(says('src/generated')).toBe(true)
    expect(says('packages/src/generated')).toBeNull()
  })

  /* The whole-segment rule. Without it `dist` matches `redistribute`, which is
     a file somebody will one day be unable to find. */
  test('a name matches a whole segment and never part of one', () => {
    const says = at('dist')
    expect(says('redistribute')).toBeNull()
    expect(says('dist-old')).toBeNull()
    expect(says('src/mydist')).toBeNull()
  })
})

describe('what a match covers', () => {
  test('matching a directory ignores everything beneath it', () => {
    const says = at('node_modules')
    expect(says('node_modules', true)).toBe(true)
    expect(says('node_modules/react/index.js')).toBe(true)
    expect(says('a/node_modules/b/c/d.js')).toBe(true)
  })

  test('a trailing slash matches directories only', () => {
    const says = at('build/')
    expect(says('build', true)).toBe(true)
    expect(says('build')).toBeNull()
  })
})

describe('globs', () => {
  test('a star stops at a separator', () => {
    const says = at('*.log')
    expect(says('error.log')).toBe(true)
    expect(says('logs/error.log')).toBe(true)
    const anchored = at('/logs/*.log')
    expect(anchored('logs/error.log')).toBe(true)
    expect(anchored('logs/deep/error.log')).toBeNull()
  })

  test('a question mark is exactly one character that is not a separator', () => {
    const says = at('file?.txt')
    expect(says('file1.txt')).toBe(true)
    expect(says('file.txt')).toBeNull()
    expect(says('file12.txt')).toBeNull()
  })

  /* A double star between separators has to match ZERO directories as well as
     many; written as `.*` it silently requires a slash that is not there. */
  test('a double star crosses any number of directories, including none', () => {
    const says = at('a/**/b')
    expect(says('a/b')).toBe(true)
    expect(says('a/x/b')).toBe(true)
    expect(says('a/x/y/z/b')).toBe(true)
    expect(says('c/a/b')).toBeNull()
  })

  test('a trailing double star is everything below', () => {
    const says = at('vendor/**')
    expect(says('vendor/x')).toBe(true)
    expect(says('vendor/x/y/z')).toBe(true)
  })

  test('a character class works, and its negated form uses git’s spelling', () => {
    expect(at('file[0-9].txt')('file7.txt')).toBe(true)
    expect(at('file[0-9].txt')('filex.txt')).toBeNull()
    expect(at('file[!0-9].txt')('filex.txt')).toBe(true)
    expect(at('file[!0-9].txt')('file7.txt')).toBeNull()
  })

  test('a dot is a literal dot and not any character', () => {
    const says = at('.env')
    expect(says('.env')).toBe(true)
    expect(says('xenv')).toBeNull()
  })

  test('an unclosed bracket is a literal bracket rather than a thrown regex', () => {
    expect(() => parseIgnore('weird[name')).not.toThrow()
    expect(at('weird[name')('weird[name')).toBe(true)
  })
})

describe('negation, and the three-valued answer that makes it possible', () => {
  test('the last matching rule decides', () => {
    const says = at('*.log\n!keep.log')
    expect(says('error.log')).toBe(true)
    expect(says('keep.log')).toBe(false)
  })

  test('order matters — a negation before the rule it would undo does nothing', () => {
    const says = at('!keep.log\n*.log')
    expect(says('keep.log')).toBe(true)
  })

  /*
   * The reason `ignoredBy` returns `boolean | null` rather than a boolean.
   * "Explicitly not ignored" has to be distinguishable from "no rule mentioned
   * this", or an inner `.gitignore` cannot override an outer one.
   */
  test('null means the rules say nothing, which is not the same as not ignored', () => {
    const says = at('*.log')
    expect(says('readme.md')).toBeNull()
    expect(at('*.log\n!keep.log')('keep.log')).toBe(false)
  })
})

describe('a chain of .gitignore files', () => {
  const chain = (levels: Level[]) => (path: string, isDir = false) => verdict(levels, path, isDir)

  test('the root’s rules apply to the whole tree', () => {
    const says = chain([{ at: '', rules: parseIgnore('*.log') }])
    expect(says('a/b/error.log')).toBe(true)
  })

  /* An inner file wins over the root, in both directions, which is the rule
     that makes nested ignores useful at all. */
  test('an inner file overrides the root', () => {
    const says = chain([
      { at: '', rules: parseIgnore('*.log') },
      { at: 'src', rules: parseIgnore('!keep.log') },
    ])
    expect(says('error.log')).toBe(true)
    expect(says('src/keep.log')).toBe(false)
    expect(says('other/keep.log')).toBe(true)
  })

  /* A level's own rules are relative to ITS directory. `/dist` in
     `packages/.gitignore` means `packages/dist` and nothing else. */
  test('an anchored rule in an inner file anchors to that inner directory', () => {
    const says = chain([
      { at: '', rules: [] },
      { at: 'packages', rules: parseIgnore('/dist') },
    ])
    expect(says('packages/dist', true)).toBe(true)
    expect(says('dist', true)).toBe(false)
    expect(says('packages/web/dist', true)).toBe(false)
  })

  test('a level whose directory the path is not under says nothing', () => {
    const says = chain([{ at: 'src', rules: parseIgnore('*') }])
    expect(says('docs/readme.md')).toBe(false)
  })

  test('nothing anywhere means not ignored', () => {
    expect(chain([])('anything')).toBe(false)
  })
})

describe('.git', () => {
  /* Not an ignore rule and never treated as one: git does not ignore `.git`,
     it simply is not part of the working tree. `read.ts` drops it before the
     ignore machinery is consulted at all. */
  test('is the only name refused unconditionally', () => {
    expect(NEVER.has('.git')).toBe(true)
    expect(NEVER.size).toBe(1)
  })

  test('does not catch .gitignore or .github', () => {
    expect(NEVER.has('.gitignore')).toBe(false)
    expect(NEVER.has('.github')).toBe(false)
  })
})
