import { describe, expect, test } from 'bun:test'

import { emptySaid, narrowToFocus, type EpicPart } from 'kehikot-module-protocol'

import { MANIFEST } from '../manifest.ts'
import { NOUN, anchorOf, heldBy, inHand, type Anchored } from '../src/focus.ts'

/*
 * The tree under a pick. The rule is the protocol's; what is tested here is
 * what a row says it is about, for both of the shapes a host sends a part in,
 * and that what is in hand is never taken away.
 */

const EPIC = 'thesis'
const PROJECT = '/tmp/p'
const file = (path: string): Anchored => ({ path, kind: 'file' })
const dir = (path: string): Anchored => ({ path, kind: 'dir' })

/** A part as a host with documents sends it (and goes on filling `files`). */
const withDocuments = (id: string, picked: boolean, documents: string[], files: string[] = []): EpicPart => ({ id, heading: id, refs: [], picked, documents, files })
/** A part as a host from before documents sends it: names relative to one folder it does not say. */
const withFiles = (id: string, picked: boolean, files: string[]): EpicPart => ({ id, heading: id, refs: [], picked, files })

const TREE: Anchored[] = [
  dir('.kehikot'),
  dir('.kehikot/notes'),
  dir('.kehikot/paper'),
  dir('.kehikot/paper/other'),
  dir('.kehikot/paper/thesis'),
  dir('.kehikot/paper/thesis/chapters'),
  file('.kehikot/paper/thesis/chapters/2_background.tex'),
  file('.kehikot/paper/thesis/chapters/3_methods.tex'),
  file('.kehikot/paper/thesis/main.tex'),
  dir('docs'),
  file('docs/design.md'),
  dir('src'),
  dir('src/sim'),
  file('src/sim/run.ts'),
  file('src/sim/plot.ts'),
  file('readme.md'),
]

const shown = (parts: EpicPart[], keep?: (row: Anchored) => boolean) => {
  const held = heldBy(parts, EPIC)
  return narrowToFocus(parts, TREE, (row) => anchorOf(row, held), { epic: EPIC, projectPath: PROJECT, keep }).shown.map((row) => row.path)
}

describe('anchorOf', () => {
  test('a file is about itself, by its own project-relative path', () => {
    expect(anchorOf(file('src/sim/run.ts'), heldBy([], EPIC))).toEqual([{ file: 'src/sim/run.ts' }])
  })

  test('a folder is about every document of the epic that lies under it, picked or not', () => {
    const held = heldBy([withDocuments('a', true, ['src/sim/run.ts']), withDocuments('b', false, ['src/other.ts', 'docs/design.md'])], EPIC)
    expect(anchorOf(dir('src'), held)).toEqual([{ file: 'src/sim/run.ts' }, { file: 'src/other.ts' }])
    expect(anchorOf(dir('src/sim'), held)).toEqual([{ file: 'src/sim/run.ts' }])
    expect(anchorOf(dir('test'), held)).toEqual([])
  })

  test('a folder that only shares a prefix with a document is not about it', () => {
    expect(anchorOf(dir('src/si'), heldBy([withDocuments('a', true, ['src/sim/run.ts'])], EPIC))).toEqual([])
  })

  test('a folder outside .kehikot offers nothing for a host’s paper-relative names', () => {
    expect(anchorOf(dir('src'), heldBy([withFiles('a', true, ['chapters/3_methods.tex'])], EPIC))).toEqual([])
  })
})

describe('a context that carries documents', () => {
  const parts = [
    withDocuments('methods', true, ['.kehikot/paper/thesis/chapters/3_methods.tex', 'src/sim/run.ts'], ['chapters/3_methods.tex']),
    withDocuments('background', false, ['.kehikot/paper/thesis/chapters/2_background.tex', 'docs/design.md'], ['chapters/2_background.tex']),
  ]

  test('nothing picked is the whole tree', () => {
    expect(shown(parts.map((part) => ({ ...part, picked: false })))).toEqual(TREE.map((row) => row.path))
  })

  test('a picked part shows its files, wherever in the project they are, and the folders they are in', () => {
    expect(shown(parts)).toEqual([
      '.kehikot',
      '.kehikot/paper',
      '.kehikot/paper/thesis',
      '.kehikot/paper/thesis/chapters',
      '.kehikot/paper/thesis/chapters/3_methods.tex',
      'src',
      'src/sim',
      'src/sim/run.ts',
    ])
  })

  test('a part with no document leaves no row, and the sentence is the protocol’s', () => {
    const none = [withDocuments('empty', true, [])]
    expect(shown(none)).toEqual([])
    expect(emptySaid(none, NOUN)).toBe('No file is in the picked part.')
  })
})

describe('a context that carries only files', () => {
  const parts = [withFiles('methods', true, ['chapters/3_methods.tex']), withFiles('background', false, ['chapters/2_background.tex', 'main.tex'])]

  test('nothing picked is the whole tree', () => {
    expect(shown(parts.map((part) => ({ ...part, picked: false })))).toEqual(TREE.map((row) => row.path))
  })

  test('a picked part shows its file and the folders down to it, and no other module’s or epic’s folder', () => {
    expect(shown(parts)).toEqual([
      '.kehikot',
      '.kehikot/paper',
      '.kehikot/paper/thesis',
      '.kehikot/paper/thesis/chapters',
      '.kehikot/paper/thesis/chapters/3_methods.tex',
    ])
  })

  test('a file at the top of the folder shows the folders above it and not the one beside it', () => {
    expect(shown([withFiles('all', true, ['main.tex'])])).toEqual(['.kehikot', '.kehikot/paper', '.kehikot/paper/thesis', '.kehikot/paper/thesis/main.tex'])
  })
})

describe('what is in hand is kept', () => {
  const parts = [withDocuments('methods', true, ['src/sim/run.ts'])]

  test('the pointed file, and the folders above it', () => {
    expect(inHand('docs/design.md', 'docs/design.md')).toBe(true)
    expect(inHand('docs', 'docs/design.md')).toBe(true)
    expect(inHand('doc', 'docs/design.md')).toBe(false)
    expect(inHand('readme.md', 'docs/design.md')).toBe(false)
    expect(inHand('readme.md', null)).toBe(false)
  })

  test('the row a menu is open on', () => {
    expect(inHand('readme.md', null, 'readme.md')).toBe(true)
  })

  test('a pointed file outside the picked part stays drawn, in its place', () => {
    expect(shown(parts, (row) => inHand(row.path, 'docs/design.md'))).toEqual(['docs', 'docs/design.md', 'src', 'src/sim', 'src/sim/run.ts'])
  })
})

describe('the manifest', () => {
  test('says it follows the parts, and no longer that it has none', () => {
    expect(MANIFEST.reacts).toContain('parts')
    expect(MANIFEST.partless).toBeUndefined()
  })
})

