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

/*
 * Waiting, nothing framing the page, no project, and this app's own server not
 * answering are not here: they are the protocol's shared `Cover`, drawn from
 * `app.tsx`, in the same words and the same look as every other module.
 */

/**
 * The root was read and there is nothing in it.
 *
 * One situation now, where there used to be two. This screen used to have to
 * work for a genuinely empty directory AND for one whose every entry was
 * ignored, and it named the count and offered a press because the second was
 * common — a build output folder somebody pointed the canvas at — and would
 * otherwise have been a dead end.
 *
 * Ignored entries are drawn now, greyed rather than hidden, so a directory that
 * holds only ignored files is a directory that shows its files. Nothing reaches
 * here but an empty one, and an empty directory has one true sentence.
 */
export function Empty() {
  return (
    <div className="space-y-2 p-3">
      <p data-testid="empty" className="text-xs text-muted-foreground">
        This folder is empty.
      </p>
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
