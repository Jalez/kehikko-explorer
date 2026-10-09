import { ask, replied, type AskFailed } from 'kehikot-module-protocol/client'

import type { Entry } from '../../tree/shape.ts'

/**
 * The one question this page asks its own server, and the one answer it can get.
 *
 * Relative URLs, always. This app is served at `/app` by the same process that
 * answers `/api/tree`, so a relative fetch is a same-origin request and needs no
 * CORS, no configured base and no knowledge of which port it happens to be on
 * today. See the storage essay in `manifest.ts` for why "same-origin" is doing
 * real work here rather than being a convenience.
 */

export type Answer =
  | { ok: true; root: string; path: string; entries: Entry[]; more: number }
  /** `down` when nothing answered at all: the shared cover says that, with Try again, so no row has to. */
  | { ok: false; error: string; down?: true }

/**
 * One directory, read once.
 *
 * `signal` is required rather than optional, and that is not fussiness. A
 * person clicking folders faster than the disk answers produces overlapping
 * reads, and two answers landing out of order writes the older listing over the
 * newer one — a folder that shows its contents and then, half a second later,
 * shows different contents, with nothing on screen saying why. Every caller
 * here is inside an effect that already has an `AbortController`; making the
 * parameter required is what stops the next caller from being the one that does
 * not.
 */
export async function readDir(projectPath: string, path: string, signal: AbortSignal): Promise<Answer> {
  /* The protocol's `ask`: one typed result for every failure, and the page's standing with its own
     server kept up to date as a side effect — which is what draws the "not answering" cover and
     reloads a page that is older than its server. */
  const asked = await ask<Answer>('./api/tree', { query: { projectPath, path: path || null }, signal })
  /*
   * An abort is not a failure and must not be drawn as one.
   *
   * It happens on every unmount and on every superseded read, which is to say
   * constantly, and a container that showed "could not reach its own store"
   * every time somebody clicked twice would be a container nobody believes
   * when it is telling the truth.
   */
  if (signal.aborted) return { ok: false, error: '' }
  try {
    return replied(asked)
  } catch (failed) {
    /* Nothing answered, a page older than its server, or an answer that is not this app's: `ask`'s
       own sentence. A refusal came back above, in the server's words — `tree/read.ts` words one. */
    const { kind, message } = failed as AskFailed
    return kind === 'down' ? { ok: false, error: message, down: true } : { ok: false, error: message }
  }
}
