import { rootOf } from './tree/confine.ts'
import { list, walk } from './tree/read.ts'
import { MAX_DEPTH, MAX_PATH, count, str, type Entry } from './tree/shape.ts'
import { ID, MANIFEST, VERSION } from './manifest.ts'

/**
 * Every door this app answers on that is not the page itself.
 *
 * ## Why this is a file of functions rather than a server
 *
 * A module is ONE ORIGIN or it is nothing. The protocol refuses a manifest
 * whose `entry` points anywhere but the origin that served the manifest, and it
 * is right to — a program that could name somebody else's page would be a
 * program that could have the host frame somebody else. The page is served by
 * Vite, because a `dist/` served off disk has cost this workspace whole
 * afternoons of a stale page answering 200 with every symptom of a working app
 * and none of the changes. So the manifest, the health check, the MCP door and
 * this app's own `/api` have to be Vite's too — they cannot be a second process
 * on a second port however much tidier that would look.
 *
 * Hence: no listener here. `answer()` takes a method, a path and a query and
 * returns a status and a document, and `vite.config.ts` adapts a node request
 * to it in a dozen lines.
 *
 * ## There is no ticket here, and the absence is the point
 *
 * The sibling modules that hold material mint a per-process ticket, print it
 * into their page, and gate every write on it. This module has no writes to
 * gate — see the bound in `manifest.ts` — so a ticket would be a credential
 * protecting nothing, and a credential that protects nothing is a thing the
 * next person adds a write behind.
 *
 * What is left is reads, and what protects those is `storage: true` plus the
 * absence of `server.cors`: with a real origin, this page's fetches are
 * same-origin, no CORS header is offered to anybody, and a page on another
 * origin gets nothing back from this port. That is the same protection the
 * ticketed modules rely on for their own page; here it is the whole of it.
 *
 * ## Nothing here trusts its caller
 *
 * The page is one caller, an agent over MCP is another, and a third is whatever
 * else on this machine found the port — this listens on loopback, which is a
 * fence around the machine and not around the programs on it. Every string is
 * bounded before it is looked at, every number is refused rather than defaulted,
 * and every path goes through `tree/confine.ts`, which is the one file that
 * decides what may be looked at.
 */

/** A status and a document. Nothing here writes bytes; the adapter does that. */
export interface Reply {
  status: number
  /** `null` means "answer with no body", which is what a notification gets. */
  body: unknown
}

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

/**
 * The refusal when nobody said which project, in one place and in two voices.
 *
 * The page's version names the state it is in — no project on the canvas — and
 * the agent's version names the argument to send, because an agent has one and
 * a person does not. Two audiences, two sentences, each naming the remedy the
 * reader actually has. Both are here rather than one being invented at the call
 * site, so a change to either is a change to a sentence somebody can read.
 */
const NO_ROOT_PAGE =
  'Nothing has said which project is open, so there is no tree to show.'
const NO_ROOT_AGENT =
  'That did not say which project, or named one this app may not read. Send projectPath as an absolute directory. '
  + 'This app will not guess: the only folder it could pick is its own, and a tree of the explorer’s source is not '
  + 'an answer to a question about your project.'

/* ------------------------------------------------------------------ *
 * The MCP door
 * ------------------------------------------------------------------ */

/**
 * One tool, and the reason there is exactly one.
 *
 * The temptation is three: a tree, a search, and a "read this file". The third
 * is refused in `manifest.ts` and is not coming back. The second — glob or
 * grep over the project — is a genuinely useful tool and is genuinely not this
 * module's: every agent on this canvas already has a file search that is faster,
 * respects more of git's rules, and does not go through an HTTP hop. Shipping a
 * worse copy of it here would mean an agent choosing between two answers to one
 * question, which is how a tool surface stops being trusted.
 *
 * So: `tree`. It answers the question this module exists to answer, in the same
 * words the person sees, from the same code path.
 */
function tools() {
  return [
    {
      name: 'tree',
      description:
        'The working tree of a project on disk: which directories and files are actually there, and which ones git '
        + 'ignores. Reads one level by default; give depth for more. Never descends into .git and never into an '
        + 'ignored directory. Names only — this tool cannot open a file, and nothing here can create, rename, move '
        + 'or delete one.',
      inputSchema: {
        type: 'object',
        properties: {
          projectPath: {
            type: 'string',
            description:
              'The absolute directory of the project to look at. Required. This is the root, and nothing outside it '
              + 'can be reached through any other argument.',
          },
          path: {
            type: 'string',
            description:
              'A directory inside the project, relative to it, to look at instead of the top. Leave it out for the '
              + 'root itself.',
          },
          depth: {
            type: 'integer',
            description:
              `How many levels below that to read, from 0 (just that directory) to ${MAX_DEPTH}. Defaults to 1. `
              + 'A deep read of a repository is a large answer nobody reads; ask for what you need.',
          },
          ignored: {
            type: 'boolean',
            description:
              'Include names git ignores. Off by default. Ignored directories are listed but never descended into, '
              + 'whatever this says — that is what keeps node_modules out of the answer.',
          },
        },
        required: ['projectPath'],
      },
    },
  ]
}

/**
 * The tree as an agent reads it, which is indented text rather than JSON.
 *
 * JSON would be the obvious answer and is the wrong one for this consumer: an
 * agent reading a directory listing is reading it the way a person does, and
 * `{"path":"src/app.tsx","kind":"file","ignored":false,"link":false}` spends
 * four times the tokens to say `src/app.tsx`. The shape of a project is exactly
 * the kind of thing indentation communicates for free.
 *
 * ## The re-nesting, which the first version did not do
 *
 * `walk` is breadth-first, and it has to be — a walk cut short by a bound
 * should have read the shallow levels rather than one deep spur. Printing that
 * order with indentation produces text that is individually correct and
 * collectively unreadable: every directory at one level, then every file at
 * that level, then the contents of the first directory, indented, forty lines
 * below the row it belongs under. Measured on this module's own repository the
 * result put `document.ts` under `vite.config.ts`, which is not where it is.
 *
 * So the entries are grouped by their parent and emitted depth-first here. The
 * order WITHIN each directory is untouched — it is the one `read.ts` sorted,
 * directories first and then names, and a second sort would be a second opinion
 * about the same list.
 *
 * The markers are single characters and each one is explained at the bottom,
 * once, because an unexplained sigil is worse than a longer word.
 */
function treeText(entries: Entry[], root: string, at: string, cut: boolean): string {
  const head = at ? `${root}/${at}` : root
  const lines = [`${head} — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`]
  if (!entries.length) {
    lines.push('(nothing here that is shown: the directory is empty, or everything in it is ignored)')
    return lines.join('\n')
  }

  const byParent = new Map<string, Entry[]>()
  for (const entry of entries) {
    const cutAt = entry.path.lastIndexOf('/')
    const parent = cutAt === -1 ? '' : entry.path.slice(0, cutAt)
    const siblings = byParent.get(parent)
    if (siblings) siblings.push(entry)
    else byParent.set(parent, [entry])
  }

  /* Iterative for the same reason `flatten.ts` is: a symlinked directory inside
     the root can point at one of its own ancestors, and a walk that recursed
     would answer that with a stack overflow rather than with a bound. */
  const stack: { entry: Entry; depth: number }[] = []
  const push = (parent: string, depth: number) => {
    const kids = byParent.get(parent) ?? []
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push({ entry: kids[i]!, depth })
  }
  push(at, 0)

  while (stack.length) {
    const { entry, depth } = stack.pop()!
    const marks = [entry.kind === 'dir' ? '/' : '', entry.link ? ' @' : '', entry.ignored ? ' (ignored)' : ''].join('')
    lines.push(`${'  '.repeat(depth)}${entry.name}${marks}`)
    if (entry.kind === 'dir') push(entry.path, depth + 1)
  }

  lines.push('', '/ is a directory, @ is a symlink.')
  if (cut) {
    lines.push(
      'This answer was cut short by a bound rather than by the end of the tree. Ask about a directory inside it '
      + 'rather than about more depth.',
    )
  }
  return lines.join('\n')
}

function call(name: string, args: Record<string, unknown>): string {
  if (name !== 'tree') throw new Error(`no tool "${name.slice(0, 60)}" here`)

  const root = rootOf(str(args.projectPath, MAX_PATH))
  if (!root) throw new Error(NO_ROOT_AGENT)

  const at = str(args.path, MAX_PATH)
  /*
   * Depth is refused rather than defaulted when it is malformed.
   *
   * `depth: "lots"` becoming 1 is this app deciding what somebody meant. The
   * refusal costs one turn and names the range; a silent default costs an agent
   * believing it asked for something it did not get.
   */
  const asked = args.depth === undefined || args.depth === null ? 1 : count(args.depth, MAX_DEPTH)
  if (asked === null) throw new Error(`depth is a whole number from 0 to ${MAX_DEPTH}, or is left out. Nothing was read.`)
  const withIgnored = args.ignored === true || args.ignored === 'true'

  if (asked === 0) {
    const one = list(root, at)
    if (!one.ok) throw new Error(one.error)
    const kept = one.entries.filter((entry) => withIgnored || !entry.ignored)
    return treeText(kept, root, one.path, one.more > 0)
  }

  const walked = walk(root, at, asked, withIgnored)
  if ('error' in walked) throw new Error(walked.error)
  return treeText(walked.entries, root, at, walked.cut)
}

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

function mcp(rpc: Rpc): Reply {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })
  const text = (s: string, isError = false) =>
    reply({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) })

  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions:
        'The working tree of a project on disk. It lists directories and files and says which ones git ignores. It '
        + 'reads lazily, never descends into .git or into an ignored directory, and confines every path to the '
        + 'project it was given. It shows names and nothing else: no file contents, and no way to create, rename, '
        + 'move or delete anything.',
    })
  }
  /* A notification carries no id and is answered with nothing. */
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) {
    return { status: 202, body: null }
  }
  if (rpc.method === 'tools/list') return reply({ tools: tools() })

  if (rpc.method === 'tools/call') {
    const name = String(rpc.params?.name ?? '')
    const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>
    try {
      return text(call(name, args))
    } catch (e) {
      /* A refusal is an answer, and the sentence is the useful half — every one
         of them names what to do instead. So it comes back as a tool error the
         agent reads, not as a transport failure it retries. */
      return text(e instanceof Error ? e.message : String(e), true)
    }
  }

  return {
    status: 404,
    body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } },
  }
}

/* ------------------------------------------------------------------ *
 * Every door, as one function
 * ------------------------------------------------------------------ */

/**
 * `null` means "this path is not ours", and the caller passes it on to Vite —
 * which is how the page, the client module and Vite's own hot-reload socket
 * keep working without being enumerated here.
 */
export function answer(method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | null): Reply | null {
  /*
   * The health check, which reports what this app IS rather than what it holds.
   *
   * There is nothing to count: no store, no cache on disk, no index. So it says
   * it is up, says its version, and says the one operational fact that is worth
   * monitoring here — whether `EXPLORER_ROOTS` is confining it, and to how many
   * directories. Not to WHICH directories: a health check is the least
   * authenticated door on this port, and printing the paths somebody's roots
   * are set to would make it a reconnaissance endpoint.
   */
  if (path === '/healthz') {
    const configured = (process.env.EXPLORER_ROOTS ?? '').split(':').filter((one) => one.trim()).length
    return ok({
      ok: true,
      id: ID,
      version: VERSION,
      roots: configured === 0 ? 'whatever the host names' : `${configured} configured`,
      writes: 'none — this module reads directory entries and nothing else',
    })
  }

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc)
  }

  /*
   * One directory.
   *
   * A GET with the root and the path in the query, because that is what it is:
   * a read, idempotent, cacheable by nothing and safe to repeat. There is no
   * POST anywhere under `/api` and there is no route that takes a body — the
   * absence is checked by `test/doors.test.ts`, so that adding one is a test
   * failure rather than a thing that quietly starts working.
   *
   * `path` is optional and its absence means the root, which is the only
   * default in this file: a request that named a project and no path is asking
   * about the project, and there is no other thing it could mean.
   */
  if (path === '/api/tree' && method === 'GET') {
    const root = rootOf(str(query.get('projectPath'), MAX_PATH))
    if (!root) return bad(NO_ROOT_PAGE)
    const at = str(query.get('path'), MAX_PATH)
    const one = list(root, at)
    if (!one.ok) return bad(one.error, 404)
    return ok({ ok: true, root, path: one.path, entries: one.entries, more: one.more })
  }

  /* An unknown path under `/api/` is ours to refuse rather than Vite's to try
     and serve as a source file. Anything else is not ours at all. */
  if (path.startsWith('/api/')) return bad('not here', 404)
  return null
}

export { MANIFEST }
