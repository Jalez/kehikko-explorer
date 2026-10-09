import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { keepView, viewOf } from '../src/store/view.ts'

/**
 * Where somebody was in the tree survives a reload of the page: the folders they had open and how
 * far they had scrolled, per project. A reload here is what it is in a browser — the page thrown
 * away and mounted again, with only `sessionStorage` carried over.
 */

const entry = (path: string, kind: 'file' | 'dir') => ({ name: path.split('/').pop()!, path, kind, ignored: false })

describe('the open folders and the scroll position, across a reload', () => {
  const realFetch = globalThis.fetch
  /** Directory path to what is in it; a path that is not here is refused, as a folder that is gone is. */
  let disk: Record<string, ReturnType<typeof entry>[]> = {}
  let asked: string[] = []
  /** Held back until released, so a test can look at the page while a folder is still being read. */
  let slow: { path: string; release: () => void; waiting: Promise<void> } | null = null

  const greet = async (projectPath: string) => {
    await act(async () => {
      window.postMessage({ type: 'kehikot.hello', protocol: 2, session: 's', state: null, context: { epic: null, theme: 'dark', project: 'p', projectPath } }, '*')
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const load = async (projectPath = '/tmp/p') => {
    render(<App />)
    await greet(projectPath)
  }
  const reload = async (projectPath = '/tmp/p') => {
    cleanup()
    mailbox.forget?.()
    asked = []
    await load(projectPath)
  }
  const press = (name: string) =>
    act(async () => {
      fireEvent.click(screen.getByTitle(name))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  const names = () => screen.queryAllByTestId('row').map((row) => row.getAttribute('title'))
  const reads = () => asked.map((url) => new URL(url, 'http://x').searchParams.get('path') ?? '')

  /*
   * A height for the scroll container, which happy-dom lays out as zero: the virtualizer draws the
   * rows that fit, and in a box of no height that is none. Only the number is stood in for.
   */
  const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
  beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 }))
  afterAll(() => {
    if (realHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realHeight)
  })

  beforeEach(() => {
    sessionStorage.clear()
    mailbox.forget?.()
    resetServerStanding()
    asked = []
    slow = null
    disk = {
      '': [entry('src', 'dir'), entry('docs', 'dir'), entry('readme.md', 'file')],
      src: [entry('src/view', 'dir'), entry('src/app.tsx', 'file')],
      'src/view': [entry('src/view/row.tsx', 'file')],
      docs: [entry('docs/notes.md', 'file')],
    }
    globalThis.fetch = (async (url: unknown) => {
      asked.push(String(url))
      const path = new URL(String(url), 'http://x').searchParams.get('path') ?? ''
      if (slow?.path === path) await slow.waiting
      const entries = disk[path]
      if (!entries) return new Response(JSON.stringify({ ok: false, error: 'There is nothing there to list inside this project.' }), { status: 404 })
      return new Response(JSON.stringify({ ok: true, root: '/tmp/p', path, entries, more: 0 }), { status: 200 })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    cleanup()
    globalThis.fetch = realFetch
    document.documentElement.className = ''
  })

  test('a folder opened before a reload is open after it, and read again', async () => {
    await load()
    await press('src')
    await press('src/view')
    expect(names()).toEqual(['src', 'src/view', 'src/view/row.tsx', 'src/app.tsx', 'docs', 'readme.md'])

    await reload()
    expect(names()).toEqual(['src', 'src/view', 'src/view/row.tsx', 'src/app.tsx', 'docs', 'readme.md'])
    expect(reads().sort()).toEqual(['', 'src', 'src/view'])
  })

  test('written as it changes: a folder closed again is closed after the reload', async () => {
    await load()
    await press('src')
    expect(viewOf('/tmp/p').open).toEqual(['src'])
    await press('src')
    expect(viewOf('/tmp/p').open).toEqual([])
    /* Nothing open and nothing scrolled is nothing held at all. */
    expect(sessionStorage.length).toBe(0)

    await reload()
    expect(names()).toEqual(['src', 'docs', 'readme.md'])
    expect(reads()).toEqual([''])
  })

  test('a folder that is gone is skipped without a word, and forgotten', async () => {
    await load()
    await press('src')
    await press('docs')
    delete disk.docs
    disk[''] = disk['']!.filter((each) => each.path !== 'docs')

    await reload()
    expect(names()).toEqual(['src', 'src/view', 'src/app.tsx', 'readme.md'])
    expect(screen.queryByTestId('trouble')).toBeNull()
    expect(document.querySelector('[data-cover]')).toBeNull()
    expect(viewOf('/tmp/p').open).toEqual(['src'])
  })

  test('kept per project: another project opens with nothing open, and the first keeps its own', async () => {
    await load()
    await press('src')

    await reload('/tmp/q')
    expect(names()).toEqual(['src', 'docs', 'readme.md'])
    expect(reads()).toEqual([''])
    await press('docs')

    await reload('/tmp/p')
    expect(names()).toEqual(['src', 'src/view', 'src/app.tsx', 'docs', 'readme.md'])
    expect(viewOf('/tmp/q').open).toEqual(['docs'])
  })

  test('a scroll is written down as it happens', async () => {
    await load()
    const scroller = screen.getByTestId('scroller')
    scroller.scrollTop = 66
    fireEvent.scroll(scroller)
    expect(viewOf('/tmp/p')).toEqual({ open: [], top: 66 })
  })

  test('the scroll position is put back only once the folders that were open have been drawn', async () => {
    keepView('/tmp/p', { open: ['src'], top: 44 })
    let release = () => {}
    slow = { path: 'src', release: () => release(), waiting: new Promise<void>((resolve) => (release = resolve)) }

    await load()
    /* The root is drawn and `src` is still being read: the tree is shorter than where it was scrolled to. */
    expect(names()).toEqual(['src', 'docs', 'readme.md'])
    const scroller = screen.getByTestId('scroller')
    expect(scroller.scrollTop).toBe(0)
    /* And the tree arriving is not somebody scrolling: nothing is written over what is held. */
    fireEvent.scroll(scroller)
    expect(viewOf('/tmp/p').top).toBe(44)

    await act(async () => {
      slow!.release()
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(names()).toEqual(['src', 'src/view', 'src/app.tsx', 'docs', 'readme.md'])
    expect(scroller.scrollTop).toBe(44)
  })

  test('something else’s string under the name is nothing held', async () => {
    sessionStorage.setItem('kehikot.explorer.view:/tmp/p', JSON.stringify({ tree: { open: 'src', top: -1 } }))
    expect(viewOf('/tmp/p')).toEqual({ open: [], top: 0 })
    sessionStorage.setItem('kehikot.explorer.view:/tmp/p', 'not json')
    await load()
    expect(names()).toEqual(['src', 'docs', 'readme.md'])
  })
})
