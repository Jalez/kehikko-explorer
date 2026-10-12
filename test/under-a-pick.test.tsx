import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'

import type { EpicPart } from 'kehikot-module-protocol'
import { resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'

/*
 * The page itself under a pick, driven as a host drives it: a greeting and
 * contexts posted to the window, `fetch` stood in for. What a row is about is
 * `focus.test.ts`; this is that the page draws what the rule leaves, says the
 * one sentence only in an empty tree, and nothing else about the pick.
 */

const EPIC = 'thesis'
const PROJECT = '/tmp/p'
const withDocuments = (id: string, picked: boolean, documents: string[]): EpicPart => ({ id, heading: id, refs: [], picked, documents, files: [] })
const withFiles = (id: string, picked: boolean, files: string[]): EpicPart => ({ id, heading: id, refs: [], picked, files })

describe('the page under a pick', () => {
  const realFetch = globalThis.fetch
  const entries = [
    { name: 'docs', path: 'docs', kind: 'dir', ignored: false },
    { name: 'src', path: 'src', kind: 'dir', ignored: false },
    { name: 'notes.md', path: 'notes.md', kind: 'file', ignored: false },
    { name: 'readme.md', path: 'readme.md', kind: 'file', ignored: false },
  ]
  const context = (over: Record<string, unknown>) => ({ epic: EPIC, theme: 'dark', project: 'p', projectPath: PROJECT, ...over })
  const post = async (message: Record<string, unknown>) => {
    await act(async () => {
      window.postMessage(message, '*')
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const greet = (over: Record<string, unknown> = {}) => post({ type: 'kehikot.hello', protocol: 2, session: 's', state: null, context: context(over) })
  const tell = (over: Record<string, unknown>) => post({ type: 'kehikot.context', protocol: 2, ...context(over) })
  const names = () => screen.queryAllByTestId('row').map((row) => row.getAttribute('title'))

  beforeEach(() => {
    resetServerStanding()
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, root: PROJECT, path: '', entries, more: 0 }), { status: 200 })) as unknown as typeof fetch
  })
  afterEach(() => {
    cleanup()
    globalThis.fetch = realFetch
    document.documentElement.className = ''
  })

  test('nothing picked draws every row and says nothing', async () => {
    render(<App />)
    await greet({ parts: [withDocuments('a', false, ['readme.md'])] })
    expect(screen.queryByTestId('none-in-focus')).toBeNull()
    expect(screen.getByTestId('scroller')).not.toBeNull()
  })

  test('a pick that leaves no row says the one sentence where the rows were, and unpicking brings the tree back', async () => {
    render(<App />)
    await greet({ parts: [withDocuments('a', true, ['elsewhere/x.md'])] })
    expect(screen.getByTestId('none-in-focus').textContent).toBe('No file is in the picked part.')
    expect(screen.queryByTestId('scroller')).toBeNull()
    await tell({ parts: [withDocuments('a', true, ['elsewhere/x.md']), withDocuments('b', true, [])] })
    expect(screen.getByTestId('none-in-focus').textContent).toBe('No file is in the picked parts.')
    await tell({ parts: [withDocuments('a', false, ['elsewhere/x.md'])] })
    expect(screen.queryByTestId('none-in-focus')).toBeNull()
    expect(screen.getByTestId('scroller')).not.toBeNull()
  })

  test('while a row is drawn nothing on the page is about the pick', async () => {
    render(<App />)
    await greet({ parts: [withDocuments('a', true, ['readme.md'])] })
    expect(screen.queryByTestId('none-in-focus')).toBeNull()
    expect(document.body.textContent).not.toMatch(/picked|part|outside/i)
  })

  test('the file the canvas is pointed at is kept under a pick that does not have it', async () => {
    render(<App />)
    await greet({
      parts: [withFiles('a', true, ['chapters/1.tex'])],
      passage: { path: `${PROJECT}/notes.md`, page: null, from: null, to: null, quoted: '', section: null },
    })
    /* happy-dom gives the scroller no height, so the virtual rows are not drawn; the scroller being there is the row being kept. */
    expect(screen.queryByTestId('none-in-focus')).toBeNull()
    expect(screen.getByTestId('scroller')).not.toBeNull()
    expect(names().every((name) => name === 'notes.md')).toBe(true)
  })
})
