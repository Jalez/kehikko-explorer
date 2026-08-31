import type { IncomingMessage } from 'node:http'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { WELL_KNOWN } from 'roadmap-module-protocol'
import { defineConfig, type Plugin } from 'vite'

import { MANIFEST, answer } from './doors.ts'
import { page } from './page/document.ts'

/**
 * Every door this app answers on, served by the one process that serves the
 * page.
 *
 * ## Why they cannot be a second server
 *
 * A module is ONE ORIGIN or it is nothing: the protocol refuses a manifest
 * whose `entry` points anywhere but the origin that served the manifest, and it
 * is right to — a program that could name somebody else's page would be a
 * program that could have the host frame somebody else.
 *
 * Here that reaches further than the manifest. The page fetches `/api/tree` as
 * a relative path, which is how the app works with nothing else running at all.
 * A reader on a second port would make every one of those fetches cross-origin
 * — and would mean this app could not read its own answers inside the frame it
 * exists to live in. So the doors are middleware in front of the same server
 * that serves the page, and `doors.ts` holds the deciding without holding a
 * socket.
 */
function doors(): Plugin {
  return {
    name: 'explorer-doors',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        const path = url.pathname
        const method = (request.method ?? 'GET').toUpperCase()

        const send = (status: number, body: unknown) => {
          if (body === null) {
            response.statusCode = status
            response.end()
            return
          }
          response.statusCode = status
          response.setHeader('content-type', 'application/json; charset=utf-8')
          response.end(JSON.stringify(body, null, 2))
        }

        /* Spelled by the protocol package so that this app and every host cannot
           disagree about it by a character. */
        if (path === WELL_KNOWN) return send(200, MANIFEST)

        if (path === '/app' || path === '/app/' || path === '/') {
          void server
            .transformIndexHtml(request.url ?? '/app', page(), request.originalUrl)
            .then((html) => {
              response.statusCode = 200
              response.setHeader('content-type', 'text/html; charset=utf-8')
              response.setHeader('cache-control', 'no-store')
              /*
               * Framed by a host and by nothing else — and by nothing at all is
               * fine too, which is what opening this page directly is.
               *
               * `frame-ancestors` is the module's own half of the arrangement: a
               * host says which origins IT will frame, and this says who may
               * frame this. It is deliberately not a list of one: whoever is
               * running this decides, through `ROADMAP_ORIGIN`, and the default
               * is the address the host in this workspace actually serves on.
               *
               * It matters more here than in a module that draws its own
               * material. A page that can be framed by anybody is a page whose
               * layout an attacker can position under a cursor, and this one's
               * rows are directory names read off somebody's disk.
               */
              response.setHeader(
                'content-security-policy',
                `frame-ancestors 'self' ${process.env.ROADMAP_ORIGIN ?? 'http://127.0.0.1:4181 http://localhost:4181'}`,
              )
              response.end(html)
            })
            .catch(next)
          return
        }

        const ours = path === '/healthz' || path === '/mcp' || path.startsWith('/api/')
        if (!ours) return next()

        /* Only `/mcp` reads a body, and only it waits for one. Vite's own
           middleware stack has to keep seeing an unconsumed request for
           everything else. */
        void body(request)
          .then((parsed) => {
            const reply = answer(method, path, url.searchParams, parsed)
            if (!reply) return next()
            send(reply.status, reply.body)
          })
          .catch(next)
      })
    },
  }
}

/**
 * The request body, as JSON, or null.
 *
 * Bounded at a megabyte, because the caller is whatever on this machine found
 * the port — loopback is a fence around the machine and not around the programs
 * on it — and a handler that reads until the socket closes is a handler that can
 * be asked to read forever. The only thing this app accepts a body for is a
 * JSON-RPC call at `/mcp`, which is a few hundred bytes; the bound is a bound
 * rather than a budget.
 *
 * Unparseable is null rather than a throw, and `doors.ts` says "that was not a
 * request" about it. A malformed body is an ordinary answer to give.
 */
const MAX_BODY_BYTES = 1_000_000

async function body(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  if ((request.method ?? 'GET').toUpperCase() !== 'POST') return null
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const piece = chunk as Buffer
    size += piece.length
    if (size > MAX_BODY_BYTES) return null
    chunks.push(piece)
  }
  if (!chunks.length) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The dev server, and the one line missing from it that matters most.
 *
 * ## No `server.cors` — this module declares storage instead
 *
 * Modules that hold nothing usually set `cors: true` and have to. A host frames
 * a module WITHOUT `allow-same-origin` unless its manifest declares storage,
 * which puts the page on an opaque origin — and `<script type="module">` is
 * ALWAYS fetched in CORS mode, so with no permissive header not one script in
 * the page runs. The document loads, `load` fires, the host greets it, and
 * nothing answers. `curl` cannot see it, being unsubject to CORS; only the
 * browser console can. That has cost this workspace days.
 *
 * This module must not go that way, for a reason worse than the ticketed
 * modules have. A permissive `Access-Control-Allow-Origin` on this port means
 * any page in any tab can ask it to list any directory under any project on
 * this machine, and READ the answer. That is a filesystem enumeration oracle
 * reachable from a tab somebody opened for another reason, and it is available
 * even though this module holds no data of its own — the data it serves is the
 * user's filesystem.
 *
 * So the manifest declares `storage: true` and this line is absent. With a real
 * origin, this page's scripts and its `/api` calls are ordinary same-origin
 * requests: no CORS is involved at all and nothing is offered to strangers.
 *
 * ## No alias for `roadmap-module-protocol`
 *
 * There used to be one, in every app here, pointing at the protocol's source in
 * the repository they all used to live in. It must not come back: the package's
 * `exports` are correct, reaching past them is what made a whole class of bug
 * possible, and a module that resolved its contract differently from the host
 * it talks to is a module testing something nobody ships.
 *
 * The `@` alias below is a different thing entirely — it points inside this
 * repository, at `src`, and is what shadcn's generated components import
 * through.
 *
 * ## There is no `build` script, and no `build` here worth having
 *
 * `run.sh` runs Vite. Nothing serves a `dist/`, so a build would produce a
 * second answer to "what does this page say" which disagrees with the first the
 * moment somebody edits `src/`. It also could not succeed: the page is
 * generated by the middleware above and there is no `index.html` for Rollup to
 * start from.
 */
export default defineConfig({
  /**
   * `base: './'`, because this page is served at `/app` here and framed by a
   * host at whatever address that host wrote down. Absolute asset paths are
   * correct in the first case and a guess in the second; relative ones are a
   * fact in both, because the browser resolves them against the document it
   * just fetched.
   */
  base: './',
  plugins: [doors(), react(), tailwindcss()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
})
