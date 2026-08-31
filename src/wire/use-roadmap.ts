import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ModuleContext } from 'roadmap-module-protocol'

import { connect, type Connection, type HostEvents } from 'roadmap-module-protocol/client'

/**
 * The bridge, as one React value.
 *
 * `roadmap-module-protocol/client` is the wire and knows no React; this is the
 * only file that turns messages into state, and it is deliberately the only
 * one. Two places driving "what can this page see" would eventually disagree.
 *
 * ## What this hook holds, which is nearly nothing
 *
 * Which project the reader is in, where that project is on disk, where in a
 * document the canvas is pointed, and a theme. Every row this container draws
 * comes from this app's own `/api`; the one thing ever ASKED of the host is
 * `passage.set`, when a person presses a file.
 *
 * ## The passage is handed on whole and never remembered
 *
 * Applied on every context including when it is null, and never kept. A
 * container that held onto the last passage would go on marking a file the
 * reader closed ten minutes ago as the one the canvas is showing —
 * indistinguishable, on screen, from it still being open. The protocol makes
 * the field nullable precisely so that "no document" is a state a module can
 * move INTO.
 *
 * ## The grace, and why there is one
 *
 * A page cannot know at load whether it is framed. The greeting arrives when
 * the host is ready rather than when we are, so a page that concluded "nobody
 * is there" in the first frame would say so and be greeted a moment later — the
 * reader sees the standalone paragraph flash past and be replaced, which
 * teaches them that paragraph is noise. So there is a `listening` state with
 * its own words, it lasts under a second, and only then does the page say the
 * harder thing.
 *
 * It is not a spinner. It says what it is waiting for.
 */
const GREETING_GRACE_MS = 700

/**
 * Whether anything is framing this page, in the three states that matter.
 *
 * Three rather than a boolean, because "we have not heard yet" is not "nobody
 * is there": one lasts under a second and the other is the standalone case.
 * Drawing the second while in the first is the flicker the grace prevents.
 */
export type Where = 'listening' | 'unhosted' | 'hosted'

/** A passage, as the context carries one. */
export type Passage = NonNullable<ModuleContext['passage']>

export interface Roadmap {
  where: Where
  /** What the project is called, as the host says it. Null when nobody has said. */
  project: string | null
  /**
   * Where that project is on disk. The root of the tree, and the only thing
   * this container is the explorer OF.
   *
   * Null is an ordinary state and not a fault: nobody has opened a project,
   * this page was opened directly on its own port, or the host has no
   * filesystem of its own to point at.
   */
  projectPath: string | null
  /**
   * Where the canvas is pointing, or null.
   *
   * Read here only to MARK a row. This page can point too — pressing a file
   * does it — and the field is read the same way whoever set it: it is the
   * host's answer about the canvas, not a memory of what this page asked for. A
   * press the host refuses changes nothing here, which is the correct outcome
   * and the reason the two are not one variable.
   */
  passage: Passage | null
  /** Say how tall this page would like its frame to be. Silent when nothing is framing it. */
  resize: (height: number) => void
  /**
   * Point every container on the canvas at a file.
   *
   * ## The bound, restated where it is actually enforced
   *
   * `manifest.ts` argues the whole case for declaring `passage:set`. What
   * matters here is the narrow part: **this is called from a press handler and
   * from nowhere else.** Not from an effect, not when a directory finishes
   * reading, not when a context arrives, not on mount. A tree that pointed the
   * canvas at whatever it noticed would be using a permission to move every
   * other container on the canvas as a side effect of its own housekeeping —
   * and the person who granted that permission was answering a question about
   * pressing files.
   *
   * If a future reader needs this inside a `useEffect`, the answer is almost
   * certainly that they do not.
   *
   * Fire and forget, and every refusal is swallowed. A host that never learned
   * the method, or has not greeted this page yet, is not a fault in the file
   * somebody just pressed and not something they can do anything about; what it
   * must not do is throw a rejection out of a click handler.
   */
  point: (passage: Passage) => void
}

/**
 * What to do when the host says "go to this reference".
 *
 * Handed in rather than handled here, because the answer depends on what is on
 * screen, and that is the view's business. The contract is the protocol's:
 * `answer` must be called, and calling it late is the same as not calling it.
 */
export type GotoHandler = NonNullable<HostEvents['onGoto']>

export function useRoadmap(id: string, onGoto: GotoHandler): Roadmap {
  const [where, setWhere] = useState<Where>('listening')
  const [project, setProject] = useState<string | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [passage, setPassage] = useState<Passage | null>(null)
  const host = useRef<Connection | null>(null)

  /**
   * The handler, held in a ref and read at the moment a `goto` arrives.
   *
   * The view rebuilds this function whenever the rows change, and connecting to
   * the window again on every render would mean a torn-down listener during the
   * one millisecond a host chose to greet in. So the listener is established
   * once and always calls the newest handler.
   */
  const goto = useRef(onGoto)
  goto.current = onGoto

  useEffect(() => {
    /**
     * What the greeting and every later context both do.
     *
     * The theme is applied here rather than in a component, because it is a
     * fact about the document rather than about any part of it. `light` is set
     * explicitly as well as `dark`, so that a host asking for light over a
     * machine set to dark actually gets it — see the media query in `index.css`.
     */
    const arrived = (context: ModuleContext) => {
      const root = document.documentElement
      root.classList.toggle('dark', context.theme === 'dark')
      root.classList.toggle('light', context.theme === 'light')

      setWhere('hosted')
      setProject(context.project ?? null)
      /*
       * Compared before it is written, both of them, because a context arrives
       * after every change anywhere on the canvas.
       *
       * `projectPath` is a string and would be safe on identity alone; it is
       * compared anyway so that the two fields this container's whole state
       * hangs off behave the same way. The passage is an OBJECT and is the one
       * that matters: the host builds a fresh `{path, page, from, to, quoted}`
       * every couple of seconds, and a new identity downstream means every memo
       * over it recomputes — which here means re-flattening a tree of several
       * thousand rows, several times a second, to draw the same rows.
       */
      setProjectPath((was) => (was === (context.projectPath ?? null) ? was : (context.projectPath ?? null)))
      setPassage((was) => (same(was, context.passage ?? null) ? was : (context.passage ?? null)))
    }

    /**
     * The connection is stored BEFORE it is told to listen, and the order is
     * the whole of a bug that made a sibling module hang forever.
     *
     * `listen()` subscribes to the mailbox, and the mailbox replays what has
     * already arrived SYNCHRONOUSLY, inside that call. The greeting almost
     * always arrives before React mounts — that is the entire reason the mailbox
     * exists — so `onHello` fires on that line, and anything reading
     * `host.current` before the assignment finds null and quietly does nothing.
     *
     * Worse, it works often enough to look fine. When the host happens to greet
     * after this effect returns — a slow module, a reload, a busy machine — the
     * assignment has already happened and everything behaves. A race whose good
     * outcome is the common one is the kind that ships.
     */
    const live = connect(id, {
      onHello: (context) => arrived(context),
      onContext: (context) => arrived(context),
      onGoto: (message, answer) => goto.current(message, answer),
    })
    host.current = live
    live.listen()

    const grace = setTimeout(() => {
      setWhere((was) => (was === 'listening' ? 'unhosted' : was))
    }, GREETING_GRACE_MS)

    return () => {
      clearTimeout(grace)
      live.stop()
      /* Cleared only if it is still ours: under StrictMode the second mount has
         already assigned its own connection by the time some cleanups run. */
      if (host.current === live) host.current = null
    }
  }, [id])

  const resize = useCallback((height: number) => host.current?.resize(height), [])

  const point = useCallback((pointed: Passage) => {
    const conversation = host.current
    if (!conversation) return
    void conversation.request('passage.set', { passage: pointed }).catch(() => {})
  }, [])

  return useMemo(
    () => ({ where, project, projectPath, passage, resize, point }),
    [where, project, projectPath, passage, resize, point],
  )
}

/** Whether two passages say the same thing. Field by field, because the object is rebuilt every context. */
function same(a: Passage | null, b: Passage | null): boolean {
  if (a === null || b === null) return a === b
  return a.path === b.path && a.page === b.page && a.from === b.from && a.to === b.to && a.quoted === b.quoted
}
