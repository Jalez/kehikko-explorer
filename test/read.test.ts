import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { list, walk } from '../tree/read.ts'

/**
 * The reader, against a real project on a real disk.
 *
 * Everything below is one temporary tree built once. It is deliberately shaped
 * like a repository somebody has — a root `.gitignore`, a nested one that
 * disagrees with it, a `node_modules`, a `.git`, and links in both directions —
 * because the failures worth catching here are the interactions between those
 * rather than any one of them alone.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-read-')))
const away = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-away-')))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(away, { recursive: true, force: true })
})

mkdirSync(join(root, 'src', 'view'), { recursive: true })
mkdirSync(join(root, 'node_modules', 'react'), { recursive: true })
mkdirSync(join(root, '.git', 'objects'), { recursive: true })
mkdirSync(join(root, 'docs'), { recursive: true })
mkdirSync(join(root, 'empty'), { recursive: true })

writeFileSync(join(root, '.gitignore'), ['node_modules', '*.log', '/dist', 'build/'].join('\n'))
writeFileSync(join(root, 'readme.md'), '#')
writeFileSync(join(root, 'error.log'), 'x')
writeFileSync(join(root, 'src', 'app.tsx'), 'x')
writeFileSync(join(root, 'src', 'debug.log'), 'x')
writeFileSync(join(root, 'src', 'view', 'row.tsx'), 'x')
writeFileSync(join(root, 'node_modules', 'react', 'index.js'), 'x')
writeFileSync(join(root, '.git', 'config'), 'x')
writeFileSync(join(root, '.git', 'objects', 'thing'), 'x')

/* A nested .gitignore that un-ignores something the root ignored. */
writeFileSync(join(root, 'docs', '.gitignore'), '!keep.log')
writeFileSync(join(root, 'docs', 'keep.log'), 'x')
writeFileSync(join(root, 'docs', 'other.log'), 'x')

/* Links: in, out, and broken. */
symlinkSync(join(root, 'src'), join(root, 'link-in'))
symlinkSync(away, join(root, 'link-out'))
symlinkSync(join(root, 'nope'), join(root, 'link-broken'))
writeFileSync(join(away, 'secret.txt'), 'never')

const names = (path: string) => {
  const answer = list(root, path)
  if (!answer.ok) throw new Error(answer.error)
  return answer.entries.map((one) => one.name)
}
const entry = (path: string, name: string) => {
  const answer = list(root, path)
  if (!answer.ok) throw new Error(answer.error)
  return answer.entries.find((one) => one.name === name)
}

describe('what a listing contains', () => {
  test('the root lists what is there', () => {
    expect(names('')).toContain('readme.md')
    expect(names('')).toContain('src')
  })

  test('paths are relative to the root, with the root itself as an empty string', () => {
    const answer = list(root, '')
    expect(answer.ok && answer.path).toBe('')
    expect(entry('', 'src')!.path).toBe('src')
    expect(entry('src', 'app.tsx')!.path).toBe('src/app.tsx')
  })

  test('directories come first, then names, case-insensitively and numerically', () => {
    const answer = list(root, 'src')
    expect(answer.ok && answer.entries.map((one) => one.name)).toEqual(['view', 'app.tsx', 'debug.log'])
  })

  test('an empty directory is an empty list rather than a refusal', () => {
    const answer = list(root, 'empty')
    expect(answer.ok && answer.entries).toEqual([])
  })

  /* A file is refused rather than answered as an empty directory, because a
     caller that cannot tell the two apart draws an expandable row that opens
     onto nothing forever. */
  test('a file is a refusal that says what happened', () => {
    const answer = list(root, 'readme.md')
    expect(answer.ok).toBe(false)
    expect(!answer.ok && answer.error).toContain('file')
  })
})

describe('.git', () => {
  test('is never listed', () => {
    expect(names('')).not.toContain('.git')
  })

  /*
   * This one caught a real hole on its first run and is the reason `read.ts`
   * refuses the path rather than only filtering the name.
   *
   * Dropping `.git` from listings means there is no row to press, which is
   * enough for the page and not for anything else: an agent at `/mcp` can name
   * a path this app never offered, and `<root>/.git` is inside the root, so
   * confinement had nothing to say about it. The answer came back holding
   * `config`.
   */
  test('is not reachable by asking for it directly', () => {
    expect(list(root, '.git').ok).toBe(false)
    expect(list(root, '.git/objects').ok).toBe(false)
  })

  test('a directory whose name merely starts with .git is unaffected', () => {
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'x')
    expect(list(root, '.github/workflows').ok).toBe(true)
  })

  test('.gitignore is not caught by the same rule', () => {
    expect(names('')).toContain('.gitignore')
  })
})

describe('the ignore rules, applied to a real tree', () => {
  test('an ignored directory is listed and marked, not hidden', () => {
    expect(entry('', 'node_modules')!.ignored).toBe(true)
    expect(entry('', 'src')!.ignored).toBe(false)
  })

  test('a pattern with no slash matches at any depth', () => {
    expect(entry('', 'error.log')!.ignored).toBe(true)
    expect(entry('src', 'debug.log')!.ignored).toBe(true)
  })

  /*
   * The inherited verdict. Everything inside an ignored directory is ignored,
   * and the reason it is computed by inheritance rather than by re-matching is
   * that the alternative is walking into `node_modules` to find out whether
   * something in it was un-ignored.
   */
  test('everything inside an ignored directory is ignored', () => {
    expect(entry('node_modules', 'react')!.ignored).toBe(true)
    expect(entry('node_modules/react', 'index.js')!.ignored).toBe(true)
  })

  test('a nested .gitignore overrides the root’s', () => {
    expect(entry('docs', 'keep.log')!.ignored).toBe(false)
    expect(entry('docs', 'other.log')!.ignored).toBe(true)
  })

  test('editing a .gitignore is picked up rather than cached until restart', () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-cache-')))
    writeFileSync(join(scratch, '.gitignore'), 'a.txt')
    writeFileSync(join(scratch, 'a.txt'), 'x')
    writeFileSync(join(scratch, 'b.txt'), 'x')

    const before = list(scratch, '')
    expect(before.ok && before.entries.find((one) => one.name === 'a.txt')!.ignored).toBe(true)

    writeFileSync(join(scratch, '.gitignore'), 'b.txt\n# a second line so the size changes too')
    const after = list(scratch, '')
    expect(after.ok && after.entries.find((one) => one.name === 'a.txt')!.ignored).toBe(false)
    expect(after.ok && after.entries.find((one) => one.name === 'b.txt')!.ignored).toBe(true)
    rmSync(scratch, { recursive: true, force: true })
  })
})

describe('symlinks', () => {
  test('a link is marked as one', () => {
    expect(entry('', 'link-in')!.link).toBe(true)
    expect(entry('', 'readme.md')!.link).toBe(false)
  })

  test('a link to a directory inside the root is a directory and opens', () => {
    expect(entry('', 'link-in')!.kind).toBe('dir')
    expect(names('link-in')).toContain('app.tsx')
  })

  /*
   * A link that leaves the root is reported as a file: there is a name here and
   * nothing under it that you may look at, which is exactly true and is what
   * the `@` on the row says.
   */
  test('a link that leaves the root is a leaf and cannot be opened', () => {
    expect(entry('', 'link-out')!.kind).toBe('file')
    expect(list(root, 'link-out').ok).toBe(false)
    expect(list(root, 'link-out/secret.txt').ok).toBe(false)
  })

  test('a broken link is a leaf rather than a thrown error', () => {
    expect(entry('', 'link-broken')!.kind).toBe('file')
  })
})

describe('confinement, at the reading layer rather than only in confine.ts', () => {
  test('traversal out of the root is refused', () => {
    expect(list(root, '../').ok).toBe(false)
    expect(list(root, '../explorer-away-nonsense').ok).toBe(false)
    expect(list(root, 'src/../../').ok).toBe(false)
  })

  test('an absolute path outside the root is refused', () => {
    expect(list(root, away).ok).toBe(false)
    expect(list(root, '/etc').ok).toBe(false)
  })

  test('every refusal to look outside says the same sentence', () => {
    const a = list(root, '../')
    const b = list(root, 'src/nope')
    expect(!a.ok && !b.ok && a.error === b.error).toBe(true)
  })
})

describe('walk — the depth an agent may ask for, and the bounds on it', () => {
  test('depth 1 reaches the children of the root’s children', () => {
    const walked = walk(root, '', 1, false)
    expect('error' in walked).toBe(false)
    if ('error' in walked) return
    const found = walked.entries.map((one) => one.path)
    expect(found).toContain('src')
    expect(found).toContain('src/app.tsx')
    expect(found).not.toContain('src/view/row.tsx')
  })

  test('depth 2 reaches one level further', () => {
    const walked = walk(root, '', 2, false)
    if ('error' in walked) throw new Error(walked.error)
    expect(walked.entries.map((one) => one.path)).toContain('src/view/row.tsx')
  })

  /*
   * The bound that matters most. `node_modules` is ignored, so it is listed and
   * never descended into — which is what keeps a depth-5 walk of a JavaScript
   * project from being minutes of IO. It is the ignore rules doing this rather
   * than a hard-coded name, so a project that genuinely tracks a vendored
   * directory still gets it walked.
   */
  test('never descends into an ignored directory, even when ignored names are shown', () => {
    const walked = walk(root, '', 5, true)
    if ('error' in walked) throw new Error(walked.error)
    const found = walked.entries.map((one) => one.path)
    expect(found).toContain('node_modules')
    expect(found).not.toContain('node_modules/react')
  })

  test('a subtree is walked from its own top', () => {
    const walked = walk(root, 'src', 1, false)
    if ('error' in walked) throw new Error(walked.error)
    expect(walked.entries.map((one) => one.path)).toContain('src/view/row.tsx')
    expect(walked.entries.map((one) => one.path)).not.toContain('readme.md')
  })

  test('a walk outside the root is a refusal', () => {
    expect('error' in walk(root, '../', 1, false)).toBe(true)
  })

  test('ignored names are left out unless asked for', () => {
    const without = walk(root, '', 1, false)
    if ('error' in without) throw new Error(without.error)
    expect(without.entries.map((one) => one.name)).not.toContain('error.log')

    const withThem = walk(root, '', 1, true)
    if ('error' in withThem) throw new Error(withThem.error)
    expect(withThem.entries.map((one) => one.name)).toContain('error.log')
  })
})
