import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Entry } from '../tree/shape.ts'

import { readDir } from '@/store/ask.ts'

/**
 * What the page knows about the tree, and how it comes to know it.
 *
 * ## Three sets and a map, and none of them is the tree
 *
 * `loaded` is directory path to its children, filled in as directories are
 * opened. `open` is what somebody expanded. `loading` is what is in flight.
 * The tree that gets DRAWN is none of these — it is computed from all three by
 * `tree/flatten.ts`, which is pure and lives outside React entirely.
 *
 * Keeping them apart is what makes the asynchrony survivable. `AsyncDataTree`
 * is asynchronous by design because reading a directory is IO, and the shape
 * that follows from that is: press marks a directory open IMMEDIATELY, the read
 * starts, the row shows as loading, and the rest of the tree is untouched
 * throughout. A model where a directory's children were the only record of it
 * being open would have to block — you cannot draw an expanded folder you have
 * no children for — and blocking is how a tree becomes a thing that freezes
 * when you click it.
 *
 * ## Closing a directory keeps its children
 *
 * Cheap to keep, instant to reopen, and the staleness it risks is handled by
 * the freshness rule below rather than by throwing the listing away. Dropping
 * them would make every reopen a round trip, which is the interaction people
 * do most.
 *
 * ## Freshness: on coming back, and on asking
 *
 * The tree goes stale the moment anything creates a file, and this app will not
 * poll. A per-tick request is refused everywhere in this workspace and it is
 * refused here for the ordinary reason plus a specific one: a poll of an
 * explorer is a `readdir` of every open directory, several times a minute, on
 * somebody's disk, forever, in a container they may not be looking at.
 *
 * Two mechanisms instead, and they were chosen over the third:
 *
 *   1. **Coming back to the tab.** `visibilitychange` — the same idiom the host
 *      uses for its own activity panel. This is when a stale tree is most
 *      obvious and it is also when it is most likely: files change because the
 *      person did something in another window, and returning to this one is
 *      exactly the moment after that happened. It costs one read per open
 *      directory, at a moment there is no other work happening.
 *   2. **Asking.** One control. A person who just ran a build and wants to see
 *      the output has a press, rather than a rule to learn about when this
 *      updates itself.
 *
 * The third was a debounced `fs.watch` on expanded directories, pushed over
 * SSE. It is the best answer and it was left out on purpose. It is a second
 * long-lived connection, a watcher lifecycle that has to follow expansion and
 * collapse exactly or leak descriptors, a debounce, and a platform-specific
 * event stream — for a benefit that is entirely "the tree updates while you
 * watch it", which is not something anybody asked for and not something a file
 * tree beside a paper is being stared at for. A recursive watch over a
 * repository was never on the table. If this is built later it replaces
 * mechanism 1 and keeps mechanism 2.
 *
 * The read on becoming visible is guarded by a cooldown, because tab switching
 * is a thing people do continuously and `visibilitychange` is not a statement
 * that anything changed.
 */
const REFRESH_COOLDOWN_MS = 3000

export interface Tree {
  loaded: ReadonlyMap<string, readonly Entry[]>
  open: ReadonlySet<string>
  loading: ReadonlySet<string>
  /** Set only when the ROOT could not be read; a failed subdirectory closes itself instead. */
  trouble: string | null
  /**
   * How many entries a directory had that the server would not send, by path.
   *
   * Carried all the way to the screen rather than swallowed here. `read.ts`
   * caps one directory at `MAX_ENTRIES`, and a container that drew the first
   * five thousand names of a twenty-thousand-name directory with nothing saying
   * so would be lying about what is on the disk — silently, in the one place
   * somebody is looking precisely to find out what is there. Measured: a
   * directory of 20,000 files answers 5,000 and this map says 15,000.
   */
  cut: ReadonlyMap<string, number>
  toggle: (path: string) => void
  /** Re-read the root and everything currently open. */
  refresh: () => void
}

export function useTree(projectPath: string | null): Tree {
  const [loaded, setLoaded] = useState<ReadonlyMap<string, readonly Entry[]>>(() => new Map())
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set())
  const [trouble, setTrouble] = useState<string | null>(null)
  const [cut, setCut] = useState<ReadonlyMap<string, number>>(() => new Map())

  /*
   * One controller per project, aborted when the project changes or the page
   * goes away.
   *
   * Not one per directory. A read that is superseded is superseded because the
   * whole tree is being replaced — a new project, or a refresh — and there is
   * no case where one directory's read should be cancelled while its siblings
   * continue. One controller is one thing to get right; a map of them is a
   * cleanup nobody maintains.
   */
  const flight = useRef<AbortController | null>(null)
  /* Read inside callbacks so that `toggle` does not have to be rebuilt on every
     arriving listing — a new `toggle` identity is a new handler on every row. */
  const openRef = useRef<ReadonlySet<string>>(open)
  openRef.current = open
  const lastRefresh = useRef(0)

  const read = useCallback(
    (root: string, paths: string[], controller: AbortController) => {
      if (!paths.length) return
      setLoading((was) => {
        const next = new Set(was)
        for (const path of paths) next.add(path)
        return next
      })
      for (const path of paths) {
        void readDir(root, path, controller.signal).then((answer) => {
          if (controller.signal.aborted) return
          setLoading((was) => {
            const next = new Set(was)
            next.delete(path)
            return next
          })
          if (answer.ok) {
            if (path === '') setTrouble(null)
            setLoaded((was) => new Map(was).set(path, answer.entries))
            setCut((was) => {
              if (!answer.more && !was.has(path)) return was
              const next = new Map(was)
              if (answer.more) next.set(path, answer.more)
              else next.delete(path)
              return next
            })
            return
          }
          /* An aborted read carries no sentence and must draw nothing. */
          if (!answer.error) return
          /*
           * A subdirectory that cannot be read closes itself; only the root
           * puts a sentence on the screen.
           *
           * A directory somebody lacks permission on is an ordinary thing to
           * find in a project, and replacing the whole tree with an error
           * because one folder in it is unreadable would be losing the answer
           * over a detail of it. Closing the row is the honest outcome: it
           * visibly did not open.
           */
          if (path === '') setTrouble(answer.error)
          else {
            setOpen((was) => {
              const next = new Set(was)
              next.delete(path)
              return next
            })
          }
        })
      }
    },
    [],
  )

  /*
   * A new project is a new tree, with nothing carried over.
   *
   * Everything is cleared before the first read rather than merged into, and
   * the failure that prevents is precise: a container moved to another project
   * that kept its old `loaded` map would draw the previous project's files
   * under the new project's root — plausible rows, wrong repository, and
   * pressing one would point the canvas at a path that is not in the project
   * anybody is looking at.
   */
  useEffect(() => {
    flight.current?.abort()
    setLoaded(new Map())
    setOpen(new Set())
    setLoading(new Set())
    setTrouble(null)
    setCut(new Map())
    if (!projectPath) return

    const controller = new AbortController()
    flight.current = controller
    read(projectPath, [''], controller)
    return () => controller.abort()
  }, [projectPath, read])

  const refresh = useCallback(() => {
    if (!projectPath) return
    flight.current?.abort()
    const controller = new AbortController()
    flight.current = controller
    lastRefresh.current = Date.now()
    /*
     * The root and everything open, and nothing else.
     *
     * Re-reading a directory that is closed would be work whose only visible
     * effect happens if somebody opens it later, at which point it would be
     * read anyway. What this does not do is drop the listings for closed
     * directories: they stay, they are refreshed when reopened by this same
     * rule on the next pass, and keeping them is what makes reopening instant.
     */
    read(projectPath, ['', ...openRef.current], controller)
  }, [projectPath, read])

  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return
      /* Tab switching is continuous and `visibilitychange` is not a statement
         that anything changed. The cooldown is what keeps a person alt-tabbing
         from issuing a readdir storm. */
      if (Date.now() - lastRefresh.current < REFRESH_COOLDOWN_MS) return
      refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const toggle = useCallback(
    (path: string) => {
      if (!projectPath) return
      const wasOpen = openRef.current.has(path)
      setOpen((was) => {
        const next = new Set(was)
        if (wasOpen) next.delete(path)
        else next.add(path)
        return next
      })
      if (wasOpen) return
      /*
       * Opened first, read second, and re-read even when the children are
       * already known.
       *
       * The order is what makes this feel immediate: the chevron turns and the
       * row shows as loading on the same frame as the press, and the listing
       * arrives whenever it arrives. Reading again on every open is the other
       * half of the freshness rule — reopening a folder is a person asking
       * about it, and the cheapest honest moment to check whether it changed.
       * It costs one `readdir`.
       */
      const controller = flight.current
      if (controller && !controller.signal.aborted) read(projectPath, [path], controller)
    },
    [projectPath, read],
  )

  return useMemo(
    () => ({ loaded, open, loading, trouble, cut, toggle, refresh }),
    [loaded, open, loading, trouble, cut, toggle, refresh],
  )
}
