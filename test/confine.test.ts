import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { contains, inside, rootOf } from '../tree/confine.ts'

/**
 * Every way out of the root that this file's author could think of, tried.
 *
 * This is the test file the module is most likely to be broken by somebody
 * changing `confine.ts` for a good reason. Each block below is a specific
 * escape rather than a general property, because the general property — "no
 * path outside the root is ever returned" — is not something a test can
 * establish and the specific escapes are what actually happen.
 *
 * The tree is built once, in a real temporary directory, because the whole
 * point is the filesystem: a `realpath` check cannot be tested against a mock
 * of the thing it exists to consult.
 */

/*
 * Realpath'd at the top, and the reason is the thing being tested.
 *
 * On macOS `/tmp` and `/var` are symlinks into `/private`, so `mkdtemp` hands
 * back a path whose realpath is different from itself. `confine.ts` realpaths
 * the root precisely so that a real target can be compared against it; a test
 * that compared against the un-realpath'd string would fail on every assertion
 * for a reason that has nothing to do with confinement, and the temptation
 * would then be to loosen the check rather than the test.
 */
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-confine-')))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/* The project, and a sibling holding the thing nobody may reach. */
const root = join(scratch, 'project')
const outside = join(scratch, 'outside')
mkdirSync(join(root, 'src', 'deep'), { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(join(root, 'src', 'app.ts'), 'inside')
writeFileSync(join(outside, 'secret.txt'), 'this must never be reached')

/**
 * The neighbour whose name STARTS with the root's name.
 *
 * `/…/project-evil` vs `/…/project`. This is the oldest bug in this family and
 * it is a prefix check written by somebody thinking about directories while the
 * language thinks about strings.
 */
const evil = `${root}-evil`
mkdirSync(evil, { recursive: true })
writeFileSync(join(evil, 'loot.txt'), 'also must never be reached')

/* Links: one that stays in, one that leaves, one that points at nothing. */
symlinkSync(join(root, 'src'), join(root, 'in-link'))
symlinkSync(outside, join(root, 'out-link'))
symlinkSync(join(scratch, 'no-such-thing'), join(root, 'broken-link'))

/** A literal NUL, built rather than typed, so no editor or tool can eat it. */
const NUL = String.fromCharCode(0)

describe('contains', () => {
  test('a directory contains itself', () => {
    expect(contains('/a/b', '/a/b')).toBe(true)
  })

  test('a directory contains what is beneath it', () => {
    expect(contains('/a/b', `/a/b${sep}c`)).toBe(true)
  })

  /* The whole reason a separator is in the comparison. */
  test('/project does not contain /project-evil', () => {
    expect(contains('/project', '/project-evil')).toBe(false)
    expect(contains('/project', '/project-evil/loot.txt')).toBe(false)
  })

  test('a trailing separator on the root does not change the answer', () => {
    expect(contains(`/a/b${sep}`, `/a/b${sep}c`)).toBe(true)
    expect(contains(`/a/b${sep}`, '/a/bc')).toBe(false)
  })
})

describe('inside', () => {
  test('an ordinary path under the root resolves', () => {
    expect(inside(root, 'src/app.ts')).toBe(join(root, 'src', 'app.ts'))
  })

  test('the root itself is inside the root', () => {
    expect(inside(root, '')).toBe(root)
  })

  test('dot is the root', () => {
    expect(inside(root, '.')).toBe(root)
  })

  /* The traversal everybody tries first, at every length. */
  test('.. is refused at every depth', () => {
    expect(inside(root, '..')).toBeNull()
    expect(inside(root, '../outside')).toBeNull()
    expect(inside(root, '../outside/secret.txt')).toBeNull()
    expect(inside(root, '../../etc/passwd')).toBeNull()
    expect(inside(root, 'src/../../outside/secret.txt')).toBeNull()
    expect(inside(root, 'src/deep/../../../outside')).toBeNull()
  })

  /* A traversal that comes back inside is fine, and must be: it is what a
     relative path in a real project looks like after a join. */
  test('.. that returns inside the root is allowed', () => {
    expect(inside(root, 'src/../src/app.ts')).toBe(join(root, 'src', 'app.ts'))
  })

  test('an absolute path outside the root is refused', () => {
    expect(inside(root, outside)).toBeNull()
    expect(inside(root, join(outside, 'secret.txt'))).toBeNull()
    expect(inside(root, '/etc/passwd')).toBeNull()
  })

  /* `resolve` treats an absolute second argument as the whole answer, so this
     is the same escape wearing an absolute path. */
  test('an absolute path INSIDE the root is allowed', () => {
    expect(inside(root, join(root, 'src', 'app.ts'))).toBe(join(root, 'src', 'app.ts'))
  })

  test('the sibling whose name starts with the root name is refused', () => {
    expect(inside(root, evil)).toBeNull()
    expect(inside(root, join(evil, 'loot.txt'))).toBeNull()
    expect(inside(root, '../project-evil/loot.txt')).toBeNull()
  })

  test('a symlink that stays inside the root is followed', () => {
    /* Answered as the REAL path, not as the link, which is what makes a second
       containment check on the answer meaningful. */
    expect(inside(root, 'in-link')).toBe(join(root, 'src'))
    expect(inside(root, 'in-link/app.ts')).toBe(join(root, 'src', 'app.ts'))
  })

  /* The escape a lexical check cannot see. */
  test('a symlink that leaves the root is refused', () => {
    expect(inside(root, 'out-link')).toBeNull()
    expect(inside(root, 'out-link/secret.txt')).toBeNull()
  })

  test('a broken symlink is refused rather than throwing', () => {
    expect(inside(root, 'broken-link')).toBeNull()
  })

  test('a path that does not exist is refused', () => {
    expect(inside(root, 'src/nope.ts')).toBeNull()
  })

  test('a relative root is refused', () => {
    expect(inside('project', 'src')).toBeNull()
    expect(inside('', 'src')).toBeNull()
  })

  /*
   * A NUL byte in a path throws inside node's own path handling on some
   * platforms and is a classic truncation trick on others. Either way the
   * answer this module gives has to be "no" rather than an exception thrown out
   * of a request handler.
   */
  test('a NUL byte is refused rather than thrown', () => {
    expect(() => inside(root, `src/app.ts${NUL}.png`)).not.toThrow()
    expect(inside(root, `src/app.ts${NUL}.png`)).toBeNull()
  })

  /*
   * Every refusal is the same refusal, which is the point of returning null
   * rather than a reason: three distinguishable answers is an oracle a caller
   * can use to ask whether a file it may not see exists.
   */
  test('every refusal is indistinguishable from every other', () => {
    const answers = [
      inside(root, '../outside/secret.txt'),
      inside(root, 'src/nope.ts'),
      inside(root, 'out-link/secret.txt'),
      inside(root, 'broken-link'),
    ]
    expect(new Set(answers).size).toBe(1)
    expect(answers[0]).toBeNull()
  })
})

describe('rootOf', () => {
  test('an absolute directory is its own real path', () => {
    expect(rootOf(root)).toBe(root)
  })

  test('a relative root is refused, so no tree of this module’s own source is ever served', () => {
    expect(rootOf('tree')).toBeNull()
    expect(rootOf('.')).toBeNull()
    expect(rootOf('')).toBeNull()
    expect(rootOf(null)).toBeNull()
    expect(rootOf(undefined)).toBeNull()
  })

  test('a root that does not exist is refused', () => {
    expect(rootOf(join(scratch, 'no-such-project'))).toBeNull()
  })

  describe('with EXPLORER_ROOTS set', () => {
    /*
     * The variable is read at call time rather than captured at import, which
     * is what makes this testable at all — and is also correct behaviour: an
     * operator changing it should not need to know whether this module happens
     * to read it once.
     */
    const before = process.env.EXPLORER_ROOTS

    test('a root inside a configured directory is allowed', () => {
      process.env.EXPLORER_ROOTS = scratch
      expect(rootOf(root)).toBe(root)
      process.env.EXPLORER_ROOTS = before
    })

    test('a root outside every configured directory is refused', () => {
      process.env.EXPLORER_ROOTS = root
      expect(rootOf(outside)).toBeNull()
      expect(rootOf(evil)).toBeNull()
      process.env.EXPLORER_ROOTS = before
    })

    /*
     * Two roots are two separate checks and never a union of prefixes. A union
     * is how `../` climbs out of one configured root and lands inside another.
     */
    test('two configured roots are checked one at a time', () => {
      process.env.EXPLORER_ROOTS = `${root}:${outside}`
      expect(rootOf(root)).toBe(root)
      expect(rootOf(outside)).toBe(outside)
      expect(rootOf(evil)).toBeNull()
      process.env.EXPLORER_ROOTS = before
    })

    test('a relative entry in the list is skipped rather than resolved', () => {
      process.env.EXPLORER_ROOTS = `relative:${root}`
      expect(rootOf(root)).toBe(root)
      expect(rootOf(outside)).toBeNull()
      process.env.EXPLORER_ROOTS = before
    })
  })
})
