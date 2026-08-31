/**
 * The document, served at `/app`.
 *
 * ## Why this is a string and not an `index.html`
 *
 * Not for the reason the sibling modules have one. They generate a page because
 * a per-process write ticket has to reach it without being fetchable on a door
 * of its own; this module has no ticket, because it has no writes.
 *
 * It is generated here for the other reason, which is a collision a sibling lost
 * half a day to. `entry` is `/app`, and under Vite dev an extensionless path is
 * not free — a request for `/app` next to an `app.tsx` resolves to that module
 * and answers `200 text/javascript` with compiled source. A browser loads such
 * a document happily and runs nothing in it: the frame's `load` fires, the host
 * greets it, and nothing answers. Claiming `/app` in middleware before Vite's
 * resolver sees it is what prevents that, and this repository has a
 * `src/app.tsx`, so the order is load-bearing rather than defensive.
 *
 * ## The two style rules that live in the document rather than in the CSS
 *
 * `height: 100%` on `html`, `body` and the root, and `overflow: hidden` on the
 * body. Both are here because they are facts about the DOCUMENT rather than
 * about anything drawn in it, and because this module needs them in a way its
 * siblings do not.
 *
 * A tree is the one container here that scrolls INTERNALLY. Notes and paper
 * measure their content and ask the host for a frame that tall; a tree cannot,
 * because a project with four thousand visible rows would be asking for a
 * thirty-thousand-pixel frame. So this page takes the height it is given and
 * scrolls inside it — which requires that the height it is given actually reach
 * the scroll container, and a default `html { height: auto }` silently breaks
 * that chain: the container measures zero, the virtualizer renders no rows, and
 * the page is blank with no error anywhere.
 *
 * `overflow: hidden` on the body is the standing rule of this workspace made
 * literal at the one level it belongs: the BODY never scrolls, in either
 * direction. Everything that scrolls does so in a container inside it, which is
 * the only arrangement where a horizontal overflow is impossible rather than
 * merely unlikely.
 *
 * Nothing else is drawn here. There is a root element and one script; every row
 * is built by React out of what this app's own `/api` answers and what the host
 * says on the wire, neither of which this file can see.
 */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Explorer</title>
<style>
html, body, #root { height: 100%; }
body { margin: 0; overflow: hidden; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>
`

/** The page. There is nothing to substitute into it, and that is the whole story. */
export function page(): string {
  return PAGE
}
