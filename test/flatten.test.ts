import { describe, expect, test } from 'bun:test'

import { flatten, type View } from '../tree/flatten.ts'
import type { Entry } from '../tree/shape.ts'

/**
 * The visible-node model, tested hard, because it is pure and because nothing
 * else in this module is as easy to get subtly and invisibly wrong.
 *
 * Every failure this file is looking for draws a plausible tree: a depth off by
 * one, children under the wrong key, a collapsed directory whose descendants
 * are still in the array, siblings emitted before descendants. None of those
 * throws and none of them looks broken in a screenshot.
 */

const dir = (path: string, ignored = false): Entry => ({
  path,
  name: path.split('/').pop()!,
  kind: 'dir',
  ignored,
  link: false,
})
const file = (path: string, ignored = false): Entry => ({
  path,
  name: path.split('/').pop()!,
  kind: 'file',
  ignored,
  link: false,
})

const view = (parts: Partial<View> & { loaded: View['loaded'] }): View => ({
  open: new Set(),
  loading: new Set(),
  ...parts,
})

const paths = (v: View) => flatten(v).map((row) => row.entry.path)

describe('the root', () => {
  test('an unread root is no rows at all', () => {
    expect(flatten(view({ loaded: new Map() }))).toEqual([])
  })

  test('an empty root is no rows at all', () => {
    expect(flatten(view({ loaded: new Map([['', []]]) }))).toEqual([])
  })

  test('the root’s own children are at depth 0', () => {
    const rows = flatten(view({ loaded: new Map([['', [dir('src'), file('readme.md')]]]) }))
    expect(rows.map((row) => row.depth)).toEqual([0, 0])
  })

  test('order comes from the server and is not re-sorted here', () => {
    /* Deliberately in an order the client would not choose, to prove nothing
       here has an opinion: one sort, on the server, in `read.ts`. */
    const rows = paths(view({ loaded: new Map([['', [file('z.md'), dir('a')]]]) }))
    expect(rows).toEqual(['z.md', 'a'])
  })
})

describe('expansion', () => {
  const loaded = new Map<string, Entry[]>([
    ['', [dir('src'), file('readme.md')]],
    ['src', [dir('src/view'), file('src/app.tsx')]],
    ['src/view', [file('src/view/row.tsx')]],
  ])

  test('a closed directory contributes one row and no descendants', () => {
    expect(paths(view({ loaded }))).toEqual(['src', 'readme.md'])
  })

  test('an open directory’s children follow it immediately', () => {
    expect(paths(view({ loaded, open: new Set(['src']) }))).toEqual([
      'src',
      'src/view',
      'src/app.tsx',
      'readme.md',
    ])
  })

  /*
   * The depth-first assertion, and the reason `flatten` carries an index per
   * sibling list rather than pushing children onto a plain stack. The naive
   * version emits every child of a level before descending, which puts
   * `readme.md` in the middle of `src`.
   */
  test('descendants come before the next sibling, at every level', () => {
    expect(paths(view({ loaded, open: new Set(['src', 'src/view']) }))).toEqual([
      'src',
      'src/view',
      'src/view/row.tsx',
      'src/app.tsx',
      'readme.md',
    ])
  })

  test('depth increases by exactly one per level', () => {
    const rows = flatten(view({ loaded, open: new Set(['src', 'src/view']) }))
    expect(rows.map((row) => `${row.entry.path}@${row.depth}`)).toEqual([
      'src@0',
      'src/view@1',
      'src/view/row.tsx@2',
      'src/app.tsx@1',
      'readme.md@0',
    ])
  })

  test('open but unread contributes one row and nothing under it', () => {
    const partial = new Map<string, Entry[]>([['', [dir('src')]]])
    expect(paths(view({ loaded: partial, open: new Set(['src']) }))).toEqual(['src'])
  })

  /* Two directories open at one level is the arrangement that catches a
     breadth-first bug that a single open folder hides. */
  test('two open siblings each keep their own children', () => {
    const two = new Map<string, Entry[]>([
      ['', [dir('a'), dir('b')]],
      ['a', [file('a/1')]],
      ['b', [file('b/1')]],
    ])
    expect(paths(view({ loaded: two, open: new Set(['a', 'b']) }))).toEqual(['a', 'a/1', 'b', 'b/1'])
  })

  test('a file that somehow appears in the open set is still a file', () => {
    const rows = flatten(view({ loaded: new Map([['', [file('x.md')]]]), open: new Set(['x.md']) }))
    expect(rows[0]!.open).toBe(false)
  })
})

describe('the three states an open directory can be in', () => {
  test('loading is marked and is not empty', () => {
    const rows = flatten(
      view({ loaded: new Map([['', [dir('src')]]]), open: new Set(['src']), loading: new Set(['src']) }),
    )
    expect(rows[0]!.loading).toBe(true)
    expect(rows[0]!.empty).toBe(false)
  })

  test('read and genuinely empty is marked empty', () => {
    const rows = flatten(
      view({ loaded: new Map([['', [dir('src')]], ['src', []]]), open: new Set(['src']) }),
    )
    expect(rows[0]!.empty).toBe(true)
    expect(rows[0]!.loading).toBe(false)
  })

  test('closed is never empty and never loading, whatever is known about it', () => {
    const rows = flatten(view({ loaded: new Map([['', [dir('src')]], ['src', []]]) }))
    expect(rows[0]!.empty).toBe(false)
    expect(rows[0]!.open).toBe(false)
  })

  /* A directory holding only ignored names is not empty, and used to read as
     empty because they were filtered out. Nothing is filtered now. */
  test('a directory holding only ignored names is not empty', () => {
    const only = new Map<string, Entry[]>([['', [dir('build')]], ['build', [file('build/out.js', true)]]])
    expect(flatten(view({ loaded: only, open: new Set(['build']) }))[0]!.empty).toBe(false)
  })
})

describe('ignored names', () => {
  const loaded = new Map<string, Entry[]>([
    ['', [dir('node_modules', true), dir('src'), file('.env', true), file('readme.md')]],
    ['src', [file('src/app.tsx'), file('src/app.log', true)]],
  ])

  /*
   * They are SHOWN, at every level, in their original places.
   *
   * They used to be filtered out behind a toggle. The owner's response to that
   * toggle was that they did not understand the point of it, and the answer VS
   * Code reached long ago was already quoted in `flatten.ts`: show them, greyed,
   * so a person can see what is in their project and tell what git will not
   * carry. `row.tsx` does the greying; this file's job is now only to not hide
   * anything.
   */
  test('are shown at every level, in their original places', () => {
    expect(paths(view({ loaded, open: new Set(['src']) }))).toEqual([
      'node_modules',
      'src',
      'src/app.tsx',
      'src/app.log',
      '.env',
      'readme.md',
    ])
  })

  /* The cost that made hiding them tempting is answered by laziness rather than
     by filtering: an unexpanded ignored directory is one row, whatever it holds. */
  test('an unexpanded ignored directory costs one row', () => {
    expect(paths(view({ loaded }))).toEqual(['node_modules', 'src', '.env', 'readme.md'])
  })
})

describe('the cycle a symlink can make', () => {
  /*
   * A symlink pointing at one of its own ancestors is legal, stays inside the
   * root, and is infinitely expandable by hand. `flatten` must terminate, and
   * it does so on a depth cap rather than on a stack overflow.
   */
  test('terminates on a self-referential expansion', () => {
    const loaded = new Map<string, Entry[]>([['', [dir('a')]]])
    const open = new Set<string>(['a'])
    /* Build a hundred nested levels, past the cap of 64. */
    let path = 'a'
    for (let i = 0; i < 100; i += 1) {
      const child = `${path}/a`
      loaded.set(path, [dir(child)])
      open.add(child)
      path = child
    }
    const rows = flatten(view({ loaded, open }))
    expect(rows.length).toBeLessThanOrEqual(64)
    expect(rows.length).toBeGreaterThan(1)
  })
})

describe('scale', () => {
  /*
   * The measurement that settles whether flattening needs to be incremental.
   *
   * Ten thousand rows is a large repository with several directories open. If
   * this were expensive it would have to be recomputed in pieces on expansion,
   * which is a much more complicated model; it is not, so it is not.
   */
  test('ten thousand rows flatten in single-digit milliseconds', () => {
    const loaded = new Map<string, Entry[]>()
    const roots: Entry[] = []
    for (let d = 0; d < 100; d += 1) {
      roots.push(dir(`d${d}`))
      loaded.set(`d${d}`, Array.from({ length: 100 }, (_, f) => file(`d${d}/f${f}.ts`)))
    }
    loaded.set('', roots)
    const open = new Set(roots.map((one) => one.path))

    const started = performance.now()
    const rows = flatten(view({ loaded, open }))
    const took = performance.now() - started

    expect(rows).toHaveLength(10_100)
    expect(took).toBeLessThan(50)
  })
})
