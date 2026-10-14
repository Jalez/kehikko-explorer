import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resetServerStanding, serverStanding } from 'kehikot-module-protocol/client'

import { TICKET, answer, setHostAsk } from '../doors.ts'
import { readDir } from '../src/store/ask.ts'

/* The page's one read against the real door, with `fetch` as the only thing faked. */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'explorer-wire-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))
writeFileSync(join(root, 'readme.md'), '#')

const realFetch = globalThis.fetch
let printed = TICKET
setHostAsk(async () => true)
let carried = ''

beforeEach(() => {
  resetServerStanding()
  printed = TICKET
  const island = document.createElement('script')
  island.id = 'ticket'
  island.type = 'application/json'
  island.textContent = JSON.stringify(printed)
  document.body.appendChild(island)
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    carried = (init.headers as Record<string, string>)['x-module-ticket'] ?? ''
    const at = new URL(url, 'http://localhost')
    const said = await answer(String(init.method ?? 'GET'), at.pathname, at.searchParams, null, carried)
    return new Response(JSON.stringify(said?.body), { status: said?.status ?? 500 })
  }) as unknown as typeof fetch
})
afterEach(() => {
  globalThis.fetch = realFetch
  document.getElementById('ticket')?.remove()
})

describe('the page’s read', () => {
  test('carries the ticket printed into the page, which the door accepts', async () => {
    const read = await readDir(root, '', new AbortController().signal)
    expect(carried).toBe(TICKET)
    expect(read.ok && read.entries.map((one) => one.name)).toEqual(['readme.md'])
    expect(serverStanding()).toBe('up')
  })

  test('a page older than its server is told so, and not that the folder is missing', async () => {
    document.getElementById('ticket')!.textContent = JSON.stringify('a-ticket-from-before-the-restart')
    const read = await readDir(root, '', new AbortController().signal)
    expect(read.ok).toBe(false)
    expect(serverStanding()).toBe('stale')
  })
})
