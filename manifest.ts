import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'roadmap-module-protocol'

export const ID = 'roadmap.explorer'
export const VERSION = '1.0.0'

/**
 * What this app says about itself when a host asks.
 *
 * The manifest is the smallest half of this program and the only half a host
 * ever reads, so it is where the BOUNDS go — the things this module has decided
 * not to be, written down at the one place somebody deciding whether to place
 * it will look.
 *
 * ## The bound that matters most: nothing here writes
 *
 * There is no create, no rename, no move, no delete, no touch, no mkdir. Not
 * "not yet" — not at all, and this sentence is here so the next person knows it
 * was a decision rather than an omission.
 *
 * A file tree is the shape of a program where every one of those is the obvious
 * next feature, and VS Code's Explorer has all of them. This one is on a canvas
 * beside a paper and a diff, in a container 220 pixels wide, reachable by
 * anything on this machine that finds the port, and driven partly by agents
 * through `/mcp`. A rename issued from a container that small, by a caller this
 * app cannot identify, against a path a stranger's program named, is a much
 * larger safety surface than "show me the files" is worth. The whole write half
 * of an explorer is deleted work that never happened.
 *
 * The corollary, and it is the second bound: **this module never serves file
 * CONTENTS.** Paper reads documents, diff reads changes; that is their job and
 * they are confined for it in their own repositories. An endpoint here that
 * returned bytes would double this app's attack surface to deliver something
 * two other modules already deliver correctly. If a future reader finds
 * themselves adding `GET /api/file`, the answer is that they are working on the
 * wrong module.
 *
 * ## `passage:set` — declared, and it is the only capability this app asks for
 *
 * Pressing a file here publishes a passage naming that file with no byte range.
 * That is this module's whole reason to exist beside the others: paper, notes
 * and diff all follow `context.passage`, so a press in Explorer moves the
 * canvas to that file. A passage with a path and no range is an established
 * shape rather than an invention — paper already has a state for exactly it,
 * and the protocol's own essay on `passageSchema` names "a document is open and
 * nothing within it is selected" as one of the three things a passage can say.
 *
 * The bound on it is copied from the sibling module that argued it out, and it
 * is narrow: **this app points when a person presses a row, and never
 * otherwise.** Not on load. Not on a context. Not when a directory finishes
 * reading. Not on any conclusion this app reached by itself. A tree that
 * pointed the canvas at whatever it happened to notice would be a module using
 * a permission to move every other container on the canvas as a side effect of
 * its own housekeeping — and the person who granted it was answering a question
 * about pressing files.
 *
 * There is no capability for CONSUMING context, and there should not be: a
 * context is broadcast to every framed module, and a list of who may read one
 * would be a permission over something the host is already sending.
 *
 * ## What is not declared
 *
 * - **`selection:set` — no.** A selection is a range inside a document. This
 *   app has never opened one and could not name a range honestly if it tried.
 * - **`epics:read`, `steps:read`, `live:read` — no.** A directory listing is
 *   not derived from a tracker. A capability asked for and never used is the
 *   fastest way to teach somebody to press yes without reading.
 * - **`stage:report` — no.** Saying where work is belongs to whoever is doing
 *   it. A folder has no opinion about that.
 * - **`view:navigate` — no.** `view.goto` names an epic, a step or a tracker
 *   ref. A row here names a file, and the honest way to walk somebody to a file
 *   is the `passage.set` above. Declaring a capability for the feature it could
 *   not have delivered is how permission prompts stop being read.
 * - **`events:emit` — no, and `emits` is empty.** Nothing here happens that
 *   somebody would otherwise miss; a person pressing a folder open already
 *   knows they did.
 * - **`state:keep` — no.** Which folders are open is worth remembering for
 *   about as long as the page is on screen, and no longer: a tree restored with
 *   yesterday's expansions into today's checkout is a container confidently
 *   showing directories that have since been deleted. It is cheap to open a
 *   folder again and expensive to explain a ghost.
 *
 * ## `prompt: false`
 *
 * A prompt is a paragraph a person writes on the canvas aimed at one container.
 * Declaring it makes a host offer one, so the question is whether there is work
 * here that has to be described before it can be done. There is not: the answer
 * this app gives is entirely determined by what is on disk under the project
 * the host named, and a paragraph cannot change what `readdir` returns.
 *
 * ## The mode is epic-scoped, because `projectPath` only arrives there
 *
 * One mode, which becomes an ordinary tab in the mode row. `scope: 'epic'`
 * because an epic-scoped mode is the one that receives `roadmap.context` — and
 * the context is where `projectPath` lives. A `global` mode is never sent one,
 * which for this app means a container that can never learn which directory it
 * is the explorer OF. The same context carries `passage`, which is how a row
 * knows to mark itself as where the canvas is pointed.
 *
 * ## Storage, and why a module that holds nothing still asks for it
 *
 * `storage: true` makes the host frame this page with `allow-same-origin`, so
 * it keeps its real origin instead of running opaque. The usual rule is that a
 * module holding no material of its own declares `false`, because an origin
 * would be a thing it had no use for. This one holds no material and declares
 * `true` anyway, and the reason is the `/api` rather than a store.
 *
 * Opaque, this page's fetches to its own `/api/tree` are CROSS-origin — an
 * opaque origin is `null` and matches nothing — so the server would have to
 * answer with permissive CORS or the app could not read its own directory
 * listings. Permissive CORS on this origin means any page in any tab can ask
 * this port for the contents of any directory inside somebody's project and
 * read the answer. That is a filesystem enumeration oracle on loopback,
 * reachable from a tab the person had open for another reason. A sibling module
 * demonstrated the shape of this rather than theorising it, with a
 * `curl -H 'Origin: https://evil.example'` that came back carrying the
 * permissive header.
 *
 * Declaring storage closes it at the root: with a real origin this page's
 * scripts and its `/api` calls are ordinary same-origin requests, no CORS
 * header is sent at all, and a stranger's page gets nothing back. The sandbox
 * is weakened by exactly what that costs, which is little — the origin this
 * page regains is `127.0.0.1:7970` and the host is on `127.0.0.1:4181`, and
 * different ports are different origins, so the page can only reach itself.
 *
 * It does not close the door to a program on this machine that speaks HTTP
 * directly; nothing on loopback can. What it closes is the browser-shaped hole,
 * which is the one an ordinary person is actually exposed to.
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  /**
   * Parsed rather than shipped as a bare object.
   *
   * The protocol package is explicit that its schemas are a convenience and
   * never the host's check — the host runs its own copy over what arrives on
   * the wire. That cuts both ways: running it HERE is the cheapest way for this
   * app to learn it has written a manifest no host will accept, and to learn it
   * when this file is imported rather than from a host's refusal in somebody
   * else's log.
   */
  protocol: PROTOCOL,
  id: ID,
  name: 'Explorer',
  version: VERSION,
  summary:
    'The working tree of the project that is open, read one directory at a time. Pressing a file points the canvas at it.',
  /**
   * What an agent should do about this module, given that it is here.
   *
   * Not the summary. The summary says what this IS, for a person deciding
   * whether to place it. This says what its PRESENCE OBLIGES, and a host
   * composes it into the prompt every agent on the canvas is handed.
   *
   * The honest thing to tell an agent about this module is mostly what it
   * cannot do, because an agent that expects a file tree to also read and write
   * files will waste a turn finding out. Bounded at 1024 characters by the
   * protocol.
   */
  guidance:
    'Explorer shows the shape of the project on disk. Call `tree` with the project directory to see what is '
    + 'actually there before you guess at a layout or a filename — it lists directories and files, marks what '
    + 'git ignores, and never descends into .git. It reads one level at a time by default; ask for more depth '
    + 'only when you need it, because a deep read of a repository is a large answer nobody reads. This module '
    + 'shows names and nothing else: it will not open a file, and it cannot create, rename, move or delete one. '
    + 'Use your own tools for contents and for edits. When a person presses a file here, the canvas is pointed '
    + 'at that file with no byte range, which is how the other containers on it follow along.',
  entry: '/app',
  modes: [{ id: 'explorer', label: 'Explorer', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    about: 'The working tree of a project on disk: directories, files, and what git ignores. Names only, never contents.',
  },
  extensions: { emits: [], consumes: [] },
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['passage:set'],
    storage: true,
    prompt: false,
  },
  health: '/healthz',
})
