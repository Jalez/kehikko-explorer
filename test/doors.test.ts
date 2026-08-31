import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MANIFEST, answer } from '../doors.ts'
import { MAX_DEPTH } from '../tree/shape.ts'

/**
 * Every door, exercised the way a stranger would.
 *
 * `answer()` is the whole server minus the socket, which is what makes this a
 * test of behaviour rather than of a mock: the same function Vite's middleware
 * calls, with the same arguments, from a test that needs no listener.
 */

const root = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-doors-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

mkdirSync(join(root, 'src'), { recursive: true })
mkdirSync(join(root, 'node_modules'), { recursive: true })
mkdirSync(join(root, '.git'), { recursive: true })
writeFileSync(join(root, '.gitignore'), 'node_modules')
writeFileSync(join(root, 'readme.md'), '#')
writeFileSync(join(root, 'src', 'app.tsx'), 'x')

const get = (path: string, query: Record<string, string> = {}) =>
  answer('GET', path, new URLSearchParams(query), null)

const rpc = (method: string, params?: Record<string, unknown>) =>
  answer('POST', '/mcp', new URLSearchParams(), { jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) })

/** The text of a tool result, or the error that came back instead. */
function toolText(reply: ReturnType<typeof rpc>): { text: string; isError: boolean } {
  const body = reply?.body as { result?: { content?: { text?: string }[]; isError?: boolean } }
  return { text: body?.result?.content?.[0]?.text ?? '', isError: body?.result?.isError === true }
}

describe('routing', () => {
  test('a path this app does not own is handed back to Vite as null', () => {
    expect(get('/src/main.tsx')).toBeNull()
    expect(get('/')).toBeNull()
    expect(get('/anything')).toBeNull()
  })

  test('an unknown path under /api is refused here rather than handed on', () => {
    /* Handed on, Vite would try to serve it as a source file — which is how a
       module accidentally publishes its own code. */
    expect(get('/api/nope')?.status).toBe(404)
  })
})

describe('/healthz', () => {
  test('says it is up, and says what it is', () => {
    const reply = get('/healthz')
    const body = reply?.body as Record<string, unknown>
    expect(reply?.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.id).toBe('roadmap.explorer')
    expect(body.writes).toContain('none')
  })

  /*
   * The health check is the least authenticated door on this port. It says how
   * many roots are configured and never which, because a list of somebody's
   * project directories handed to anything that asks is a reconnaissance
   * endpoint wearing a monitoring hat.
   */
  test('never prints the configured root paths', () => {
    const before = process.env.EXPLORER_ROOTS
    process.env.EXPLORER_ROOTS = `${root}:/somewhere/else`
    const body = get('/healthz')?.body as Record<string, unknown>
    expect(JSON.stringify(body)).not.toContain(root)
    expect(JSON.stringify(body)).not.toContain('/somewhere/else')
    expect(body.roots).toBe('2 configured')
    process.env.EXPLORER_ROOTS = before
  })
})

describe('/api/tree', () => {
  test('answers the root of a project', () => {
    const reply = get('/api/tree', { projectPath: root })
    const body = reply?.body as { ok: boolean; entries: { name: string }[] }
    expect(reply?.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.entries.map((one) => one.name)).toContain('readme.md')
  })

  test('answers a directory inside it', () => {
    const body = get('/api/tree', { projectPath: root, path: 'src' })?.body as { entries: { name: string }[] }
    expect(body.entries.map((one) => one.name)).toEqual(['app.tsx'])
  })

  test('a request with no project is refused in words a person can read', () => {
    const reply = get('/api/tree')
    expect(reply?.status).toBe(400)
    expect((reply?.body as { error: string }).error).toContain('which project')
  })

  test('a relative project path is refused, so this module never serves its own source', () => {
    expect(get('/api/tree', { projectPath: '.' })?.status).toBe(400)
    expect(get('/api/tree', { projectPath: 'tree' })?.status).toBe(400)
  })

  test('a path outside the project is refused', () => {
    expect(get('/api/tree', { projectPath: root, path: '../' })?.status).toBe(404)
    expect(get('/api/tree', { projectPath: root, path: '/etc' })?.status).toBe(404)
  })

  test('.git is refused even though it is inside the project', () => {
    expect(get('/api/tree', { projectPath: root, path: '.git' })?.status).toBe(404)
  })
})

/**
 * The bound from `manifest.ts`, asserted rather than promised.
 *
 * There is no write path and no way to read a file's contents. These two tests
 * are here so that adding either is a test failure with a sentence attached
 * rather than a feature that quietly starts working.
 */
describe('the two things this module will not do', () => {
  test('there is no route that writes', () => {
    for (const path of ['/api/tree', '/api/file', '/api/rename', '/api/delete', '/api/mkdir']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const reply = answer(method, path, new URLSearchParams({ projectPath: root }), { name: 'x' })
        expect(reply === null || reply.status >= 400).toBe(true)
      }
    }
  })

  test('no door anywhere returns the contents of a file', () => {
    writeFileSync(join(root, 'secret.md'), 'THE-CONTENTS-OF-A-FILE')
    const everywhere = [
      JSON.stringify(get('/api/tree', { projectPath: root })?.body),
      JSON.stringify(get('/api/tree', { projectPath: root, path: 'secret.md' })?.body),
      toolText(rpc('tools/call', { name: 'tree', arguments: { projectPath: root, depth: 3 } })).text,
    ].join('\n')
    expect(everywhere).not.toContain('THE-CONTENTS-OF-A-FILE')
    /* The NAME is present, which is the whole job. */
    expect(everywhere).toContain('secret.md')
  })
})

describe('/mcp', () => {
  test('takes POST and refuses anything else', () => {
    expect(get('/mcp')?.status).toBe(405)
  })

  test('a body that is not a request is refused as one', () => {
    const reply = answer('POST', '/mcp', new URLSearchParams(), null)
    expect(reply?.status).toBe(400)
  })

  test('initialize names this server and says what it will not do', () => {
    const body = rpc('initialize')?.body as { result: { serverInfo: { name: string }; instructions: string } }
    expect(body.result.serverInfo.name).toBe('roadmap.explorer')
    expect(body.result.instructions).toContain('no file contents')
  })

  test('a notification is answered with nothing at all', () => {
    const reply = rpc('notifications/initialized')
    expect(reply?.status).toBe(202)
    expect(reply?.body).toBeNull()
  })

  test('an unknown method is a JSON-RPC error rather than a tool error', () => {
    expect(rpc('resources/list')?.status).toBe(404)
  })

  /* One tool, deliberately. The count is asserted so that adding a second is a
     decision somebody makes rather than one that happens. */
  test('there is exactly one tool', () => {
    const body = rpc('tools/list')?.body as { result: { tools: { name: string }[] } }
    expect(body.result.tools.map((one) => one.name)).toEqual(['tree'])
  })

  describe('the tree tool', () => {
    const tree = (args: Record<string, unknown>) => toolText(rpc('tools/call', { name: 'tree', arguments: args }))

    test('reads one level by default', () => {
      const { text, isError } = tree({ projectPath: root })
      expect(isError).toBe(false)
      expect(text).toContain('readme.md')
      expect(text).toContain('src/')
      expect(text).toContain('app.tsx')
    })

    test('depth 0 is just that directory', () => {
      const { text } = tree({ projectPath: root, depth: 0 })
      expect(text).toContain('src/')
      expect(text).not.toContain('app.tsx')
    })

    test('ignored names are left out unless asked for, and marked when shown', () => {
      expect(tree({ projectPath: root }).text).not.toContain('node_modules')
      expect(tree({ projectPath: root, ignored: true }).text).toContain('node_modules/ (ignored)')
    })

    test('.git never appears at any depth', () => {
      expect(tree({ projectPath: root, depth: MAX_DEPTH, ignored: true }).text).not.toContain('.git/')
    })

    /*
     * The bug this caught on a real repository: `walk` is breadth-first, so
     * printing its output in order put every directory at one level, then every
     * file at that level, then the first directory's contents indented forty
     * lines below the row they belong under. Individually correct lines,
     * collectively a tree of the wrong shape.
     */
    test('children are printed under their own parent, not in walk order', () => {
      const { text } = tree({ projectPath: root, depth: 2 })
      const lines = text.split('\n')
      const src = lines.indexOf('src/')
      const app = lines.indexOf('  app.tsx')
      const readme = lines.indexOf('readme.md')
      expect(src).toBeGreaterThan(-1)
      expect(app).toBe(src + 1)
      /* And a top-level file is not swallowed into the directory above it. */
      expect(readme).toBeGreaterThan(app)
    })

    test('a missing project is a tool error naming the argument to send', () => {
      const { text, isError } = tree({})
      expect(isError).toBe(true)
      expect(text).toContain('projectPath')
    })

    /*
     * Refused rather than defaulted. `depth: "lots"` quietly becoming 1 is this
     * app deciding what somebody meant; the refusal costs one turn and names
     * the range.
     */
    test('a malformed depth is refused rather than read as the default', () => {
      expect(tree({ projectPath: root, depth: 'lots' }).isError).toBe(true)
      expect(tree({ projectPath: root, depth: -1 }).isError).toBe(true)
      expect(tree({ projectPath: root, depth: MAX_DEPTH + 1 }).isError).toBe(true)
    })

    test('a path outside the project is a tool error', () => {
      expect(tree({ projectPath: root, path: '../' }).isError).toBe(true)
    })

    test('an unknown tool name says so without echoing an unbounded string', () => {
      const { text, isError } = toolText(rpc('tools/call', { name: 'x'.repeat(500), arguments: {} }))
      expect(isError).toBe(true)
      expect(text.length).toBeLessThan(120)
    })
  })
})

describe('the manifest this app serves', () => {
  test('declares passage:set and nothing else', () => {
    expect(MANIFEST.declares.uses).toEqual(['passage:set'])
  })

  /* The whole argument is in `manifest.ts`; this is the line that fails if
     somebody flips it while tidying. Opaque, this origin would need permissive
     CORS, and permissive CORS here is a filesystem enumeration oracle. */
  test('declares storage, which is what keeps the /api same-origin', () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('asks for no prompt and emits nothing', () => {
    expect(MANIFEST.declares.prompt).toBe(false)
    expect(MANIFEST.extensions.emits).toEqual([])
  })

  test('its one mode is epic-scoped, because that is where projectPath arrives', () => {
    expect(MANIFEST.modes).toHaveLength(1)
    expect(MANIFEST.modes[0]!.scope).toBe('epic')
  })

  test('the guidance tells an agent what this module cannot do', () => {
    expect(MANIFEST.guidance).toContain('cannot create, rename, move or delete')
  })
})
