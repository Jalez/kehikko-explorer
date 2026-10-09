import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { resetServerStanding } from 'kehikot-module-protocol/client'

import { App } from '../src/app.tsx'
import { readDir } from '../src/store/ask.ts'

import { flatten } from '../tree/flatten.ts'
import type { Entry } from '../tree/shape.ts'

import { ROW_HEIGHT, TreeRow } from '../src/view/row.tsx'
import { Empty, Trouble } from '../src/view/screens.tsx'

/**
 * The real components, rendering the words a person actually reads.
 *
 * These are the tests that catch the failures a unit test of a pure function
 * cannot: a screen that says the wrong thing, a row that is pressable when it
 * should not be, a name that widens the container past its frame.
 *
 * They render the components rather than the whole `App`, deliberately. `App`
 * owns a wire connection, a fetch, and a virtualizer that needs a laid-out
 * scroll container — none of which happy-dom has — so a test of it would be a
 * test of three stubs. What is worth asserting here is what each piece SAYS,
 * and that is exactly what these render.
 */

const file = (path: string, extra: Partial<Entry> = {}): Entry => ({
  path,
  name: path.split('/').pop()!,
  kind: 'file',
  ignored: false,
  link: false,
  ...extra,
})
const dir = (path: string, extra: Partial<Entry> = {}): Entry => ({ ...file(path, extra), kind: 'dir' })

const row = (entry: Entry, over: Partial<Parameters<typeof TreeRow>[0]['row']> = {}) => ({
  entry,
  depth: 0,
  open: false,
  loading: false,
  empty: false,
  ...over,
})

const nothing = { toggle: () => {}, point: () => {} }

describe('a row', () => {
  test('draws its name and nothing else', () => {
    render(<TreeRow row={row(file('src/app.tsx'))} pointed={false} actions={nothing} />)
    expect(screen.getByTestId('row').textContent).toBe('app.tsx')
  })

  /* The name is truncated on screen, so the whole relative path has to be one
     hover away or a narrow container is a column of unreadable stubs. */
  test('carries the whole relative path as a title', () => {
    render(<TreeRow row={row(file('src/view/a-very-long-component-name.tsx'))} pointed={false} actions={nothing} />)
    expect(screen.getByTestId('row').getAttribute('title')).toBe('src/view/a-very-long-component-name.tsx')
  })

  test('a directory has a chevron and a file does not', () => {
    const { unmount } = render(<TreeRow row={row(dir('src'))} pointed={false} actions={nothing} />)
    expect(screen.queryByTestId('chevron')).not.toBeNull()
    unmount()
    render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={nothing} />)
    expect(screen.queryByTestId('chevron')).toBeNull()
  })

  test('the chevron says what pressing it will do', () => {
    const { unmount } = render(<TreeRow row={row(dir('src'))} pointed={false} actions={nothing} />)
    expect(screen.getByTestId('chevron').getAttribute('aria-label')).toBe('open src')
    unmount()
    render(<TreeRow row={row(dir('src'), { open: true })} pointed={false} actions={nothing} />)
    expect(screen.getByTestId('chevron').getAttribute('aria-label')).toBe('close src')
  })

  test('pressing a file points, and pressing a directory toggles', () => {
    const pressed: string[] = []
    const actions = { toggle: (p: string) => pressed.push(`toggle:${p}`), point: (p: string) => pressed.push(`point:${p}`) }

    const { unmount } = render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={actions} />)
    screen.getByTestId('row').click()
    unmount()

    render(<TreeRow row={row(dir('src'))} pointed={false} actions={actions} />)
    screen.getByTestId('row').click()
    expect(pressed).toEqual(['point:a.ts', 'toggle:src'])
  })

  /*
   * Nothing framing the page means there is no canvas to point, so a file row
   * is disabled rather than silently inert — the cursor says so before the
   * press does nothing.
   */
  test('a file is disabled when nothing is framing the page', () => {
    render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={{ toggle: () => {}, point: null }} />)
    expect((screen.getByTestId('row') as HTMLButtonElement).disabled).toBe(true)
  })

  test('a directory is still pressable when nothing is framing the page', () => {
    render(<TreeRow row={row(dir('src'))} pointed={false} actions={{ toggle: () => {}, point: null }} />)
    expect((screen.getByTestId('row') as HTMLButtonElement).disabled).toBe(false)
  })

  test('a symlink says so', () => {
    render(<TreeRow row={row(file('link', { link: true }))} pointed={false} actions={nothing} />)
    expect(screen.getByTestId('row').textContent).toContain('@')
  })

  test('an open and answered directory with nothing in it says empty', () => {
    render(<TreeRow row={row(dir('src'), { open: true, empty: true })} pointed={false} actions={nothing} />)
    expect(screen.getByText('empty')).toBeDefined()
  })

  test('an ignored name is greyed once it is shown', () => {
    const { container } = render(<TreeRow row={row(file('.env', { ignored: true }))} pointed={false} actions={nothing} />)
    expect(container.firstElementChild!.className).toContain('text-muted-foreground')
  })

  test('the pointed row is marked, and the marking beats the ignored grey', () => {
    const { container } = render(<TreeRow row={row(file('.env', { ignored: true }))} pointed actions={nothing} />)
    expect(container.firstElementChild!.className).toContain('bg-pointed')
    expect(container.firstElementChild!.className).not.toContain('text-muted-foreground')
  })

  /*
   * Every row is exactly `ROW_HEIGHT` tall, and the constant is the same one
   * `index.css` writes as `--row`. A disagreement between them is rows that
   * overlap as you scroll, which reads as a rendering fault rather than as a
   * wrong number.
   */
  test('is exactly one row tall, at the height the stylesheet also uses', async () => {
    const { container } = render(<TreeRow row={row(file('a.ts'))} pointed={false} actions={nothing} />)
    expect((container.firstElementChild as HTMLElement).style.height).toBe(`${ROW_HEIGHT}px`)
    const css = await Bun.file(`${import.meta.dir}/../src/index.css`).text()
    expect(css).toContain(`--row: ${ROW_HEIGHT}px`)
  })

  /*
   * Indentation is capped, because it is the one thing on a row that can push
   * the name off the edge of a 220-pixel container. Ten levels in, a deeper
   * file stops moving right rather than disappearing.
   */
  test('indentation stops rather than pushing a deep name off the edge', () => {
    const shallow = render(<TreeRow row={row(file('a.ts'), { depth: 3 })} pointed={false} actions={nothing} />)
    const at3 = (shallow.container.firstElementChild as HTMLElement).style.paddingLeft
    shallow.unmount()
    const deep = render(<TreeRow row={row(file('a.ts'), { depth: 40 })} pointed={false} actions={nothing} />)
    const at40 = (deep.container.firstElementChild as HTMLElement).style.paddingLeft
    expect(at3).toBe('30px')
    expect(at40).toBe('100px')
  })
})

describe('the rows a real listing produces', () => {
  /*
   * One test that runs the pure model and the component together, because the
   * seam between them — a `Row` from `flatten` handed to `TreeRow` — is the
   * only place a field can be renamed on one side and read on the other.
   */
  test('flatten’s output renders without any adaptation', () => {
    const loaded = new Map<string, Entry[]>([
      ['', [dir('src'), file('readme.md')]],
      ['src', [file('src/app.tsx')]],
    ])
    const rows = flatten({ loaded, open: new Set(['src']), loading: new Set() })
    render(
      <>
        {rows.map((one) => (
          <TreeRow key={one.entry.path} row={one} pointed={false} actions={nothing} />
        ))}
      </>,
    )
    expect(screen.getAllByTestId('row').map((el) => el.textContent)).toEqual(['src', 'app.tsx', 'readme.md'])
  })
})

describe('the screens that are not a tree', () => {
  /*
   * One sentence now, where there used to be two. A directory whose every entry
   * is ignored shows those entries greyed, so nothing but a genuinely empty
   * directory reaches this screen — and an empty directory has one true thing
   * to say.
   */
  test('an empty folder says so, plainly', () => {
    render(<Empty />)
    expect(screen.getByTestId('empty').textContent).toBe('This folder is empty.')
  })

  test('trouble says the server’s own sentence rather than rewording it', () => {
    render(<Trouble said="There is nothing there to list inside this project." />)
    expect(screen.getByTestId('trouble').textContent).toBe('There is nothing there to list inside this project.')
  })

  /*
   * The standing complaint about these modules is that they say too much. No
   * screen here is allowed to open with a wall of prose, so the shortest useful
   * bound is asserted: nothing above thirty words.
   */
  test('no screen says more than a couple of lines', () => {
    for (const [name, element] of [
      ['empty', <Empty key="e" />],
    ] as const) {
      const { container, unmount } = render(element)
      const words = (container.textContent ?? '').trim().split(/\s+/).length
      expect(`${name}:${words <= 30}`).toBe(`${name}:true`)
      unmount()
    }
  })
})

/*
 * The moments this page has no tree to draw, each as the protocol's one shared cover. Driven
 * through `App` itself — a greeting posted to the window, `fetch` stood in for — because which
 * cover is in front is a decision `App` makes, and the order of that decision is the thing that
 * was wrong before: "no project" used to be reachable only after the grace, and a server that did
 * not answer was a red sentence or a row that silently closed.
 */
describe('the not-ready moments, each as the one shared cover', () => {
  const realFetch = globalThis.fetch
  let down = false
  let refuse: string | null = null
  let asked: string[] = []
  const listing = { ok: true, root: '/tmp/p', path: '', entries: [{ name: 'readme.md', path: 'readme.md', kind: 'file', ignored: false }], more: 0 }
  const greet = async (context: Record<string, unknown>) => {
    await act(async () => {
      window.postMessage({ type: 'kehikot.hello', protocol: 2, session: 's', state: null, context: { epic: null, theme: 'dark', ...context } }, '*')
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
  }
  const cover = () => document.querySelector('[data-cover]')
  const settle = (ms: number) => act(async () => void (await new Promise((resolve) => setTimeout(resolve, ms))))

  beforeEach(() => {
    down = false
    refuse = null
    asked = []
    resetServerStanding()
    globalThis.fetch = (async (url: unknown) => {
      asked.push(String(url))
      if (down) throw new TypeError('Load failed')
      if (refuse) return new Response(JSON.stringify({ ok: false, error: refuse }), { status: 404 })
      return new Response(JSON.stringify(listing), { status: 200 })
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    cleanup()
    globalThis.fetch = realFetch
    document.documentElement.className = ''
  })

  test('before anything has greeted the page it is waiting — never "no project" — and then unhosted', async () => {
    render(<App />)
    await settle(30)
    expect(cover()?.getAttribute('data-cover')).toBe('waiting')
    expect(document.body.textContent).toContain('Waiting for Kehikot…')
    expect(document.body.textContent).not.toContain('No project')
    await settle(800)
    expect(cover()?.getAttribute('data-cover')).toBe('unhosted')
    expect(document.body.textContent).toContain('Nothing is framing this page — open Explorer in Kehikot.')
    /* No folder box and nothing to press: a picker here would be a tree of a project nobody is in. */
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(within(cover() as HTMLElement).queryAllByRole('button')).toHaveLength(0)
    /* And nothing was read: there is no root to read. */
    expect(asked).toHaveLength(0)
  })

  test('hosted with no project: no project, in the host’s theme, and still nothing to press', async () => {
    render(<App />)
    await greet({ project: null, projectPath: null })
    expect(cover()?.getAttribute('data-cover')).toBe('no-project')
    expect(document.body.textContent).toContain('No project is open — open one in Kehikot.')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(asked).toHaveLength(0)
  })

  test('greeted with a project, the cover is gone and the root is read once, by a relative path', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p', theme: 'light' })
    expect(cover()).toBeNull()
    expect(asked.some((url) => url.startsWith('./api/tree?projectPath=%2Ftmp%2Fp'))).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('its own server not answering says so, and Try again reads again', async () => {
    down = true
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p' })
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    expect(document.body.textContent).toContain('Explorer’s own server is not answering.')
    /* Not the red sentence: nothing is wrong with the folder, and nothing has been said about it. */
    expect(screen.queryByTestId('trouble')).toBeNull()
    const before = asked.length
    down = false
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(asked.length).toBeGreaterThan(before)
    expect(cover()).toBeNull()
  })

  test('a server that stops under an open tree covers it without unmounting it', async () => {
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/p' })
    const scroller = screen.getByTestId('scroller')
    down = true
    await act(async () => {
      fireEvent.click(screen.getByTestId('refresh'))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()?.getAttribute('data-cover')).toBe('down')
    /* The same element, hidden: what was open and where it was scrolled to are still there. */
    expect(screen.getByTestId('scroller')).toBe(scroller)
    expect(scroller.closest('[hidden]')).not.toBeNull()
    down = false
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(cover()).toBeNull()
    expect(screen.getByTestId('scroller')).toBe(scroller)
    expect(scroller.closest('[hidden]')).toBeNull()
  })

  test('a root the server refuses is the server’s own sentence, not a cover', async () => {
    refuse = 'There is nothing there to list inside this project.'
    render(<App />)
    await greet({ project: 'p', projectPath: '/tmp/gone' })
    expect(cover()).toBeNull()
    expect(screen.getByTestId('trouble').textContent).toBe('There is nothing there to list inside this project.')
  })

  test('a failed read is one of three things, and an abort is none of them', async () => {
    down = true
    expect(await readDir('/tmp/p', '', new AbortController().signal)).toEqual({
      ok: false,
      error: 'This app’s own server is not answering.',
      down: true,
    })
    down = false
    refuse = 'No.'
    expect(await readDir('/tmp/p', 'src', new AbortController().signal)).toEqual({ ok: false, error: 'No.' })
    expect(asked.at(-1)).toBe('./api/tree?projectPath=%2Ftmp%2Fp&path=src')
    /* Superseded reads happen constantly; one that drew a sentence would be a container nobody believes. */
    const gone = new AbortController()
    gone.abort()
    down = true
    expect(await readDir('/tmp/p', '', gone.signal)).toEqual({ ok: false, error: '' })
  })
})
