/**
 * The screens that are not a tree, and each one names why it is there.
 *
 * Every one of these is a place where a lesser version of this app would draw
 * an empty list and let the reader conclude something wrong. An empty list says
 * "this project has no files in it". These say which of the three quite
 * different reasons that is.
 *
 * ## The words are short on purpose
 *
 * The standing complaint about these modules is that they say too much on
 * screen. Every sentence below was longer once. What is left is the one fact a
 * person needs and, where there is one, the thing they can do about it — in
 * their words rather than in this codebase's private ones. The reasoning that
 * used to be on screen is in these comments, which is where it belongs: it is
 * for whoever changes this file, not for somebody looking for a file.
 */

/** Waiting for a greeting, for under a second, saying what it is waiting for. */
export function Listening() {
  return (
    <div className="p-3">
      <p className="text-xs text-muted-foreground">Waiting to be told which project is open…</p>
    </div>
  )
}

/**
 * Nobody said where the project is, so there is no root and no tree.
 *
 * `projectPath` is nullable on the wire for perfectly ordinary reasons — nobody
 * has opened a project, this page was opened directly on its own port, or the
 * host has no filesystem of its own to point at — and not one of them is this
 * app being broken. So there is no spinner and no error colour.
 *
 * There is also no press, and that is the decision. The obvious escape hatch is
 * a box to type a folder into, and it is exactly wrong: this app would then be
 * showing a directory nobody on the canvas is working in, while every other
 * container shows the project. A tree of the wrong project is worse than no tree,
 * because it looks right.
 *
 * The heading appears only when nothing is framing this page. A host prints the
 * module's name in the container header; a page that also printed "Explorer" at
 * the top of itself would be saying the name twice and spending a fixed strip
 * of a short container on the repetition.
 */
export function NoProject({ unhosted }: { unhosted: boolean }) {
  return (
    <div className="space-y-2 p-3">
      {unhosted ? <h1 className="text-sm font-semibold">Explorer</h1> : null}
      <p data-testid="no-project" className="text-xs text-muted-foreground">
        {unhosted
          ? 'Nothing is framing this page, so nothing has said which project to show.'
          : 'This canvas has not said which project is open, so there is nothing to show yet.'}
      </p>
    </div>
  )
}

/**
 * The root was read and there is nothing in it that this container is showing.
 *
 * Two quite different situations reach this, and the sentence has to work for
 * both: a genuinely empty directory, and a directory whose every entry is
 * ignored. The second is common — a build output folder somebody pointed the
 * canvas at — and it is why the toggle is mentioned rather than assumed. Naming
 * the number is what stops the screen from being a dead end.
 */
export function Empty({ hidden, onShowIgnored }: { hidden: number; onShowIgnored: () => void }) {
  return (
    <div className="space-y-2 p-3">
      <p data-testid="empty" className="text-xs text-muted-foreground">
        {hidden ? `Nothing here but ${hidden} ignored file${hidden === 1 ? '' : 's'}.` : 'This folder is empty.'}
      </p>
      {hidden ? (
        <button type="button" className="text-xs underline underline-offset-2" onClick={onShowIgnored}>
          show them
        </button>
      ) : null}
    </div>
  )
}

/**
 * The root could not be read.
 *
 * The one screen drawn in a colour, because it is the one state where something
 * is actually wrong. The sentence comes from the server rather than being
 * composed here — `tree/read.ts` gives one refusal for "outside the root",
 * "does not exist" and "cannot be read", deliberately, and rewording it on the
 * way to the screen would be this page inventing a distinction the server
 * refused to draw.
 */
export function Trouble({ said }: { said: string }) {
  return (
    <div className="p-3">
      <p data-testid="trouble" className="text-xs text-red-600 dark:text-red-400">
        {said}
      </p>
    </div>
  )
}
