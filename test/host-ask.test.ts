import { describe, expect, test } from 'bun:test'

import { hostAllows, hostSays } from '../host-ask.ts'

const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:9' }
const reply = (status: number, body: unknown) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch
const says = (fetch: typeof globalThis.fetch) => hostSays('/some/project', { env, fetch })

describe('what the host says of a folder', () => {
  test('a host that holds it says yes', async () => {
    expect(await says(reply(200, { ok: true, project: true }))).toBe('yes')
  })
  test('a host that does not hold it says no, and the folder is not read', async () => {
    expect(await says(reply(200, { ok: true, project: false }))).toBe('no')
    expect(await hostAllows('/some/project', { env, fetch: reply(200, { ok: true, project: false }) })).toBe(false)
  })
  test('a host that refuses the question says no', async () => {
    expect(await says(reply(403, { ok: false }))).toBe('no')
  })
  test('a host from before 0.1.19 answers but has no such route: unknown, and the folder is read as before', async () => {
    expect(await says(reply(404, { ok: false, error: 'not here' }))).toBe('unknown')
    expect(await says(reply(200, '<html></html>'))).toBe('unknown')
    expect(await hostAllows('/some/project', { env, fetch: reply(404, {}) })).toBe(true)
  })
  test('nobody answering reads nothing', async () => {
    const down = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    expect(await says(down)).toBe('nobody')
    expect(await hostAllows('/some/project', { env, fetch: down })).toBe(false)
  })
  test('a relative path is never read', async () => {
    expect(await hostSays('src', { env, fetch: reply(200, { ok: true, project: true }) })).toBe('no')
  })
})
