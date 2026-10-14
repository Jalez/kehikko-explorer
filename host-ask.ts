import { hostIsProjectUrls, isProjectResult } from 'kehikot-module-protocol/serve'
import { LIMITS } from 'kehikot-module-protocol'

/**
 * Does the host hold this folder as a project? (protocol 1.4.0, `GET /host/is-project`)
 *
 * `hostHasProject` in the protocol answers a bare boolean and fails closed, so a host from before
 * 0.1.19 — which has no such route and answers 404 — reads as "no" and this app would stop showing
 * every project there. Here a host that ANSWERS but does not know the route is "unknown", and then
 * the app does what it did before: its own roots check alone. Not answering at all (nothing
 * listening, a timeout) still reads nothing.
 */
export type HostSays = 'yes' | 'no' | 'unknown' | 'nobody'

export async function hostSays(folder: string, options: { fetch?: typeof fetch; env?: Record<string, string | undefined>; timeoutMs?: number } = {}): Promise<HostSays> {
  if (typeof folder !== 'string' || !folder.trim() || !folder.trim().startsWith('/')) return 'no'
  const asked = options.fetch ?? fetch
  let answered = false
  let said: HostSays = 'nobody'
  for (const url of hostIsProjectUrls(folder.trim(), options.env ?? process.env)) {
    const control = new AbortController()
    const timer = setTimeout(() => control.abort(), options.timeoutMs ?? LIMITS.HOST_ASK_MS)
    try {
      const response = await asked(url, { signal: control.signal })
      answered = true
      if (response.status === 403) { said = 'no'; continue }
      if (!response.ok) continue
      const read = isProjectResult.safeParse(await response.json().catch(() => null))
      if (read.success) {
        if (read.data.project) return 'yes'
        said = 'no'
      }
    } catch {
      /* Not listening here, or too slow: the next origin. */
    } finally {
      clearTimeout(timer)
    }
  }
  if (said === 'no') return 'no'
  return answered ? 'unknown' : 'nobody'
}

/** Whether a folder may be read: the host holds it, or is a host that cannot say. */
export async function hostAllows(folder: string, options?: Parameters<typeof hostSays>[1]): Promise<boolean> {
  const word = await hostSays(folder, options)
  return word === 'yes' || word === 'unknown'
}
