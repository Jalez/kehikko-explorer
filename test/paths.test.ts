import { describe, expect, test } from 'bun:test'

import { absoluteOf, rootOf, spell } from '../tree/paths.ts'

/**
 * The two spellings of a path, and the edges that produce a plausible wrong one.
 *
 * Every failure this file guards against looks correct on screen. `//` in the
 * middle of an absolute path resolves to the same file on POSIX, so a menu
 * copying `/home/me/project//src/a.ts` appears to work — right up until that
 * string is compared to the one another container built, which is what
 * `pointedAt` does on every context. An empty relative path pastes as nothing
 * at all, which is the silent copy the whole feature exists to eliminate.
 */

const ROOT = '/Users/me/Projects/thing'

describe('the absolute spelling', () => {
  test('is the root and the row’s path, joined once', () => {
    expect(spell(ROOT, 'src/app.tsx').absolute).toBe('/Users/me/Projects/thing/src/app.tsx')
  })

  test('a top-level row is one segment under the root', () => {
    expect(spell(ROOT, 'package.json').absolute).toBe('/Users/me/Projects/thing/package.json')
  })

  /*
   * A host may say the root either way and mean the same directory. The two
   * spellings must not survive into the string, because `//` works — a wrong
   * path that resolves is worse than one that fails.
   */
  test('a trailing slash on the root does not become a double slash', () => {
    expect(spell(`${ROOT}/`, 'src/app.tsx').absolute).toBe(spell(ROOT, 'src/app.tsx').absolute)
    expect(spell(`${ROOT}///`, 'src/app.tsx').absolute).toBe(spell(ROOT, 'src/app.tsx').absolute)
  })

  /* The one root that is entirely trailing slash. Stripping it would turn
     `/etc` into `etc`, which is a different file or none. */
  test('the filesystem root keeps its slash', () => {
    expect(spell('/', 'etc/hosts').absolute).toBe('/etc/hosts')
    expect(spell('/', '').absolute).toBe('/')
  })

  test('the root itself spells as the root, with no trailing slash', () => {
    expect(spell(ROOT, '').absolute).toBe(ROOT)
    expect(spell(`${ROOT}/`, '').absolute).toBe(ROOT)
  })

  /* Names are taken as they come off the disk. A file legitimately called
     `a b.ts` or `résumé.md` must arrive on the clipboard as itself, unescaped
     and un-encoded — quoting is the shell's problem and guessing at it here
     would corrupt the paths that need no quoting. */
  test('spaces and non-ascii in a name are left exactly as they are', () => {
    expect(spell(ROOT, 'docs/a b.md').absolute).toBe(`${ROOT}/docs/a b.md`)
    expect(spell(ROOT, 'docs/résumé.md').absolute).toBe(`${ROOT}/docs/résumé.md`)
  })
})

describe('the relative spelling', () => {
  test('is the row’s own path, which is already relative to the root', () => {
    expect(spell(ROOT, 'src/view/row.tsx').relative).toBe('src/view/row.tsx')
  })

  test('does not depend on how the root was spelled', () => {
    expect(spell(`${ROOT}/`, 'src/a.ts').relative).toBe('src/a.ts')
    expect(spell('/', 'src/a.ts').relative).toBe('src/a.ts')
  })

  /*
   * The root itself, which is the decision worth having a test for. `''` on a
   * clipboard is a copy that did nothing; `.` is what every shell, `git` and
   * `ls` already read as "this directory", so it pastes usefully.
   */
  test('the root itself is a dot rather than an empty string', () => {
    expect(spell(ROOT, '').relative).toBe('.')
  })
})

describe('the root', () => {
  test('loses every trailing slash but never becomes empty', () => {
    expect(rootOf(`${ROOT}/`)).toBe(ROOT)
    expect(rootOf(`${ROOT}////`)).toBe(ROOT)
    expect(rootOf('/')).toBe('/')
    expect(rootOf('///')).toBe('/')
  })

  /*
   * The two directions have to agree or a row stops marking itself: `app.tsx`
   * builds an absolute path to point the canvas, and strips `${root}/` back off
   * the passage that comes home to decide which row is pointed at. This is that
   * round trip.
   */
  test('a path built with the root can be taken apart with it again', () => {
    for (const root of [ROOT, `${ROOT}/`, `${ROOT}//`]) {
      const absolute = absoluteOf(root, 'src/app.tsx')
      expect(absolute.startsWith(`${rootOf(root)}/`)).toBe(true)
      expect(absolute.slice(rootOf(root).length + 1)).toBe('src/app.tsx')
    }
  })
})
