import { describe, expect, test } from 'bun:test'
import { render, screen } from '@testing-library/react'

import { flatten } from '../tree/flatten.ts'
import type { Entry } from '../tree/shape.ts'

import { ROW_HEIGHT, TreeRow } from '../src/view/row.tsx'
import { Empty, Listening, NoProject, Trouble } from '../src/view/screens.tsx'

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
  test('listening says what it is waiting for, rather than spinning', () => {
    render(<Listening />)
    expect(screen.getByText(/which project is open/)).toBeDefined()
  })

  test('unframed and unhosted say different true things, and neither offers a folder box', () => {
    const { unmount } = render(<NoProject unhosted />)
    expect(screen.getByTestId('no-project').textContent).toContain('Nothing is framing this page')
    expect(screen.queryByRole('textbox')).toBeNull()
    unmount()
    render(<NoProject unhosted={false} />)
    expect(screen.getByTestId('no-project').textContent).toContain('has not said which project')
  })

  /* The heading is printed only when nothing else is printing it. A host puts
     the module's name in the container header. */
  test('the name is printed only when nothing is framing the page', () => {
    const { unmount } = render(<NoProject unhosted />)
    expect(screen.queryByRole('heading')).not.toBeNull()
    unmount()
    render(<NoProject unhosted={false} />)
    expect(screen.queryByRole('heading')).toBeNull()
  })

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
      ['listening', <Listening key="l" />],
      ['no project', <NoProject key="n" unhosted={false} />],
      ['empty', <Empty key="e" />],
    ] as const) {
      const { container, unmount } = render(element)
      const words = (container.textContent ?? '').trim().split(/\s+/).length
      expect(`${name}:${words <= 30}`).toBe(`${name}:true`)
      unmount()
    }
  })
})
