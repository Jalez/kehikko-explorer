import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import type { Entry } from '../tree/shape.ts'

import { RowMenu } from '../src/view/menu.tsx'
import { TreeRow, type RowActions } from '../src/view/row.tsx'

/**
 * The menu, and the two halves of it that a pure test cannot reach.
 *
 * `test/paths.test.ts` covers what the strings are and `test/place.test.ts`
 * covers where the menu goes. What is left, and what is here, is the behaviour
 * a person actually performs: right-clicking a row, opening the menu without a
 * mouse, moving through it with arrows, and getting out of it again.
 *
 * The one thing asserted more than once is that opening this menu does not
 * point the canvas. That bound is argued in `manifest.ts`, restated in
 * `wire/use-roadmap.ts`, and it is exactly the kind of thing a later
 * convenience — "select the row you right-clicked, like a file manager does" —
 * would break without anybody noticing, because the wrong behaviour looks
 * perfectly reasonable on screen.
 */

const ROOT = '/Users/me/Projects/thing'

const file = (path: string, extra: Partial<Entry> = {}): Entry => ({
  path,
  name: path.split('/').pop()!,
  kind: 'file',
  ignored: false,
  link: false,
  ...extra,
})
const dir = (path: string): Entry => ({ ...file(path), kind: 'dir' })

const row = (entry: Entry) => ({ entry, depth: 0, open: false, loading: false, empty: false })

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

/*
 * Torn down between tests, which the sibling render tests do by hand with
 * `unmount`. Here it has to be automatic: several of these assert on
 * `document.activeElement`, and a previous test's menu left in the document is
 * a second thing that can hold focus and a second set of `menu-item`s for a
 * query to find.
 */
afterEach(() => {
  cleanup()
  if (original) Object.defineProperty(navigator, 'clipboard', original)
  else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard')
})

/** A `navigator.clipboard` that records what it was handed. */
function recording(): string[] {
  const written: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    value: {
      writeText: async (text: string) => {
        written.push(text)
      },
    },
    configurable: true,
    writable: true,
  })
  return written
}

const at = (path: string) => ({ path, x: 20, y: 20, from: null })

describe('what is in the menu', () => {
  test('two items, worded the way VS Code words them', () => {
    render(<RowMenu at={at('src/app.tsx')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    expect(screen.getAllByTestId('menu-item').map((one) => one.textContent)).toEqual([
      'Copy path',
      'Copy relative path',
    ])
  })

  /*
   * The absent items are asserted, not just the present ones. Every one of
   * these is a write — and this module has no write half at all, which
   * `manifest.ts` argues and `test/doors.test.ts` asserts on the server. A menu
   * offering them would be the first place that bound broke.
   */
  test('offers nothing that would change a file', () => {
    const { container } = render(
      <RowMenu at={at('src/app.tsx')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />,
    )
    const words = (container.textContent ?? '').toLowerCase()
    for (const forbidden of ['rename', 'delete', 'new file', 'new folder', 'cut', 'paste', 'move', 'open']) {
      expect(`${forbidden}:${words.includes(forbidden)}`).toBe(`${forbidden}:false`)
    }
  })

  test('the two items carry the two spellings of the same path', () => {
    render(<RowMenu at={at('src/view/row.tsx')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    expect(screen.getAllByTestId('menu-item').map((one) => one.getAttribute('data-copies'))).toEqual([
      `${ROOT}/src/view/row.tsx`,
      'src/view/row.tsx',
    ])
  })

  /* Hovering an item says what will land on the clipboard, which is the answer
     to "relative to what" without spending a line of the container on it. */
  test('each item’s hover text is the exact string it will copy', () => {
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    const items = screen.getAllByTestId('menu-item')
    expect(items.map((one) => one.getAttribute('title'))).toEqual([`${ROOT}/a.ts`, 'a.ts'])
  })
})

describe('choosing an item', () => {
  test('copy path puts the absolute path on the clipboard', async () => {
    const written = recording()
    render(<RowMenu at={at('src/app.tsx')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    screen.getAllByTestId('menu-item')[0]!.click()
    await Promise.resolve()
    expect(written).toEqual([`${ROOT}/src/app.tsx`])
  })

  test('copy relative path puts the project-relative path on the clipboard', async () => {
    const written = recording()
    render(<RowMenu at={at('src/app.tsx')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    screen.getAllByTestId('menu-item')[1]!.click()
    await Promise.resolve()
    expect(written).toEqual(['src/app.tsx'])
  })

  test('the menu closes as the copy is made, rather than after it', () => {
    recording()
    let closed = false
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={() => {}} onClose={() => (closed = true)} />)
    screen.getAllByTestId('menu-item')[0]!.click()
    expect(closed).toBe(true)
  })

  /* The whole reason `copy` returns a value instead of nothing: the page has to
     be able to tell somebody when a copy did not happen. */
  test('the outcome is reported, so a failure can be said out loud', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true, writable: true })
    const results: string[] = []
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={(r) => results.push(r)} onClose={() => {}} />)
    screen.getAllByTestId('menu-item')[0]!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(results).toEqual(['failed'])
  })
})

describe('the keyboard', () => {
  test('focus lands on the first item as the menu opens', () => {
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    expect(document.activeElement).toBe(screen.getAllByTestId('menu-item')[0]!)
  })

  test('arrows move between the items and wrap at both ends', () => {
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    const [first, second] = screen.getAllByTestId('menu-item') as [HTMLElement, HTMLElement]
    const menu = screen.getByTestId('row-menu')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    /* Wrapping, because a two-item menu where Down on the last item does
       nothing reads as broken rather than as bounded. */
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(second)
  })

  test('home and end go to the ends', () => {
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />)
    const [first, second] = screen.getAllByTestId('menu-item') as [HTMLElement, HTMLElement]
    const menu = screen.getByTestId('row-menu')
    fireEvent.keyDown(menu, { key: 'End' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(menu, { key: 'Home' })
    expect(document.activeElement).toBe(first)
  })

  test('escape closes it', () => {
    let closed = false
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={() => {}} onClose={() => (closed = true)} />)
    fireEvent.keyDown(screen.getByTestId('row-menu'), { key: 'Escape' })
    expect(closed).toBe(true)
  })

  /* A menu is a modal thing. Tabbing out of one while it stays open leaves a
     panel floating over a page nobody is looking at. */
  test('tab closes it rather than moving inside it', () => {
    let closed = false
    render(<RowMenu at={at('a.ts')} projectPath={ROOT} onCopied={() => {}} onClose={() => (closed = true)} />)
    fireEvent.keyDown(screen.getByTestId('row-menu'), { key: 'Tab' })
    expect(closed).toBe(true)
  })

  /*
   * Closing puts focus back on the element the menu was opened from. Without
   * this a keyboard user who presses Escape is at the top of the document, and
   * their place in a tree of several thousand rows is gone.
   */
  test('closing gives focus back to the row it was opened from', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    render(
      <RowMenu at={{ path: 'a.ts', x: 20, y: 20, from: opener }} projectPath={ROOT} onCopied={() => {}} onClose={() => {}} />,
    )
    fireEvent.keyDown(screen.getByTestId('row-menu'), { key: 'Escape' })
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('opening the menu from a row', () => {
  const asked: { path: string; x: number; y: number }[] = []
  const pointed: string[] = []
  const actions: RowActions = {
    toggle: () => {},
    point: (path) => pointed.push(path),
    menu: (path, x, y) => asked.push({ path, x, y }),
  }

  test('a right-click asks for the menu at the pointer, and does not point the canvas', () => {
    asked.length = 0
    pointed.length = 0
    render(<TreeRow row={row(file('src/app.tsx'))} pointed={false} actions={actions} />)
    fireEvent.contextMenu(screen.getByTestId('row'), { clientX: 50, clientY: 60 })
    expect(asked).toEqual([{ path: 'src/app.tsx', x: 50, y: 60 }])
    /* The bound from `manifest.ts`, at the one place it would be broken. */
    expect(pointed).toEqual([])
  })

  test('a right-click on a directory asks too, and does not open or close it', () => {
    asked.length = 0
    const toggled: string[] = []
    render(
      <TreeRow
        row={row(dir('src'))}
        pointed={false}
        actions={{ ...actions, toggle: (path) => toggled.push(path) }}
      />,
    )
    fireEvent.contextMenu(screen.getByTestId('row'), { clientX: 10, clientY: 12 })
    expect(asked).toEqual([{ path: 'src', x: 10, y: 12 }])
    expect(toggled).toEqual([])
  })

  /*
   * Shift+F10 and the Menu key, handled here rather than left to the browser.
   * On macOS neither produces a `contextmenu` event at all, so a menu that
   * relied on one would be reachable by mouse only — which is half the people
   * using this unable to open it.
   */
  test('shift+F10 opens it', () => {
    asked.length = 0
    render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={actions} />)
    fireEvent.keyDown(screen.getByTestId('row'), { key: 'F10', shiftKey: true })
    expect(asked.map((one) => one.path)).toEqual(['a.ts'])
  })

  test('the menu key opens it', () => {
    asked.length = 0
    render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={actions} />)
    fireEvent.keyDown(screen.getByTestId('row'), { key: 'ContextMenu' })
    expect(asked.map((one) => one.path)).toEqual(['a.ts'])
  })

  test('F10 without shift is left alone, because it belongs to the browser', () => {
    asked.length = 0
    render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={actions} />)
    fireEvent.keyDown(screen.getByTestId('row'), { key: 'F10' })
    expect(asked).toEqual([])
  })

  /* A row rendered without a menu — a bare `TreeRow` in a test, or any future
     caller that does not want one — must not swallow the browser's own. */
  test('a row with no menu action leaves the right-click alone', () => {
    render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={{ toggle: () => {}, point: () => {} }} />)
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    screen.getByTestId('row').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
