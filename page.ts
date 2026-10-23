/* The one place this page's head is written: the dev server (`vite.config.ts`) and the build (`build.ts`) both use it. */

/**
 * The two style rules that live in the document rather than in the CSS, handed to the protocol's
 * `pageDocument` as its `head`.
 *
 * `height: 100%` on `html`, `body` and the root, and `overflow: hidden` on the body. A tree is the
 * one container here that scrolls INTERNALLY: a project with four thousand visible rows cannot ask
 * the host for a thirty-thousand-pixel frame, so this page takes the height it is given and scrolls
 * inside it — which requires that the height actually reach the scroll container. A default
 * `html { height: auto }` silently breaks that chain: the container measures zero, the virtualizer
 * renders no rows, and the page is blank with no error anywhere.
 *
 * `overflow: hidden` on the body is the standing rule of this workspace made literal: the BODY
 * never scrolls, in either direction. Everything that scrolls does so in a container inside it.
 */
export const PAGE_HEAD = '<style>html, body, #root { height: 100%; } body { margin: 0; overflow: hidden; }</style>'
