# Explorer

The working tree of the project that is open, read one directory at a time.
Pressing a file points the canvas at it.

An app. Its own page, its own port, and no way to write a byte. A host may frame
it, and then it learns which project is open and where on the canvas somebody is
pointing.

```
./run.sh                      # http://127.0.0.1:7970
bun run register              # tell a host on this machine where it answers
bun test                      # 212 tests, no browser needed for any of them
bun run typecheck
```

## Why it exists beside the other modules

Paper shows a document. Notes shows what somebody wrote about a passage of one.
Diff shows what changed. All three follow one field in the context the host
broadcasts — `passage`, which names a file and optionally a range inside it — so
all three are always looking at the same place.

Nothing on the canvas could say **which** place. Every module was a consumer of
that field and none of them was a producer of the simplest kind of value it can
hold: a file, with nothing selected in it. That is what this is. Pressing a row
here publishes `passage.set` with a path and no range, and paper, notes and diff
move to that file.

So: a file tree, in the spirit of VS Code's Explorer, whose reason to exist is
the one press.

## What it will not do

Written here as well as in `manifest.ts`, because a stranger reading this
directory should not have to find out by looking for a feature that is missing.

- **It does not write.** No create, no rename, no move, no delete, no mkdir. Not
  "not yet" — not at all. A rename issued from a container 220 pixels wide, by a
  caller this app cannot identify, against a path a stranger's program named, is
  a much larger safety surface than "show me the files" is worth.
- **It does not serve file contents.** Paper reads documents and diff reads
  changes; both are confined for it in their own repositories. An endpoint here
  that returned bytes would double this app's attack surface to deliver
  something two other modules already deliver correctly.
- **It does not point at anything on its own.** Not on load, not on a context,
  not when a directory finishes reading. Only when a person presses a file.
  `dev/pointing.mjs` sits where the host sits and counts, so that is a measured
  claim rather than an intention.
- **It never walks `node_modules` eagerly**, or anything else. One `readdir` per
  press, forever.

## The context menu

Right-click a row — or press Shift+F10, or the Menu key, wherever focus is on
one — and there are two items:

- **Copy path**, the absolute path.
- **Copy relative path**, relative to the project root the host named, which is
  what the tree is rooted at and what VS Code means by the same words.

That is the whole menu. Everything else VS Code puts in this menu is either a
write — see above, there is no write half — or something this app has no way to
do: nothing in a framed page can ask an operating system to reveal a file in a
Finder window. Pressing a row still points the canvas and opening the menu still
does not, which `dev/copying.mjs` counts alongside everything else.

The clipboard is the part with a trap in it. `navigator.clipboard.writeText` has
a default permissions-policy allowlist of `self`, and every module here is on
its own port and therefore cross-origin to its host — so without
`allow="clipboard-write"` on the frame the promise rejects, silently, and the
person finds out at the paste. The host sends the attribute now. This app also
falls back to a `<textarea>` and `document.execCommand('copy')`, which is not
gated by that policy, and says so on screen when neither worked. `bun test`
covers the branches; `node dev/copying.mjs` frames the real page with and
without the attribute and reads the real clipboard back.

## How it stays fast

The owner asked which library VS Code builds its Explorer on. There is not one
you can install: it is `AsyncDataTree` over `vs/base/browser/ui/tree` and
`.../list`, internal to that codebase and unpublished. What transfers is two
techniques, and both are here.

**A flattened visible-node model.** A tree on screen is not a tree, it is a list
— the rows currently visible, top to bottom. The nesting is kept as it comes off
disk and `tree/flatten.ts` turns it into a flat array whenever something expands
or collapses. That file is pure, takes four plain values, and has the longest
test file in the repository pointed at it.

**Virtualization.** `@tanstack/react-virtual` over that array, so only the rows
in view are in the DOM. It is headless, which is what lets it compose with
shadcn rather than fight it. It is used unconditionally rather than above some
row count: a branch would mean the code path that runs on every real project is
the one nobody exercises by hand.

**And the reads are lazy and asynchronous**, which is the third thing
`AsyncDataTree` gets right. Pressing a folder marks it open on the same frame,
starts the read, shows the row as loading, and leaves the rest of the tree
alone. Nothing ever blocks on IO.

Measured on this machine, at 220×300, against a directory of twenty thousand
files:

```
5,000 rows, 28 in the DOM, 107ms from navigation to the first row,
6ms to jump to the middle, no horizontal overflow
```

`node dev/measure.mjs [project]` produces that table at four container sizes.
The 5,000 is `MAX_ENTRIES` — one directory's answer is capped, and the page says
so in a line rather than truncating silently.

## Judgement calls

**Ignored files are hidden behind a toggle, not greyed in place.** VS Code greys
them, which is right for a sidebar the height of a monitor. This container is
routinely under 300 pixels tall, about twelve rows, and in a JavaScript project
the ignored set at the root is often larger than the tracked one. Greying them
would mean the first screen of an explorer is mostly things the person has
already decided are not their code. So they are hidden, the toggle says how many
(`show 6 ignored`), and when they come back they come back greyed — because at
that point VS Code's answer is exactly right.

**`.git` is not behind that toggle. It is not in the answer at all.** git does
not ignore `.git`; it simply is not part of the working tree. It also holds
every object in the repository's history and, in `config`, credentials on some
machines. It is refused as a destination and not merely filtered out of
listings — that distinction was a real hole, found by a test, and is why
`tree/read.ts` checks the path segment by segment.

**Freshness is `visibilitychange` plus a `refresh` press.** No polling: this
workspace refuses per-tick requests everywhere, and a poll here is a `readdir`
of every open directory forever in a container nobody may be looking at. Coming
back to the tab is when a stale tree is most obvious and most likely, since
files change because the person did something in another window. A debounced
`fs.watch` over expanded directories pushed on SSE would be better and was left
out on purpose: it is a second long-lived connection and a watcher lifecycle
that has to follow expansion exactly or leak descriptors, for a benefit that is
entirely "the tree updates while you watch it". A recursive watch over a
repository was never on the table.

**The `.gitignore` rules are implemented rather than delegated to
`git check-ignore`.** Three reasons, and the third decides: a subprocess per
directory read; it needs the folder to be a repository at all; and it cannot be
tested without one. The supported subset and the deliberate omissions are listed
at the top of `tree/ignore.ts`. The cost of every omission is the same and it is
small — a name is greyed that git would have shown, and the toggle is one press.

## Security

This module reads somebody's filesystem, which makes it the most dangerous one
in the workspace.

- Every path in a request is `resolve`d, then `realpath`ed, then checked against
  the realpathed root **with a separator**, so `/project-evil` does not pass a
  `/project` check. Both the lexical check and the check on the resolved answer
  are made; the second is the one that catches a symlink. `tree/confine.ts` is
  the only file allowed to decide this and `test/confine.test.ts` exists
  entirely to try to get past it.
- Every refusal is the same refusal. "Outside the root", "does not exist" and
  "cannot be read" come back as one word, because three distinguishable answers
  is an oracle a caller can use to ask whether a file it may not see exists.
- The root comes from `context.projectPath`, which the host broadcasts. Set
  `EXPLORER_ROOTS` to a colon-separated list of absolute directories to bound
  which roots this will accept at all; unset means it explores whatever the host
  names, which is the same posture every module here has.
- `storage: true` and no `server.cors`. Opaque, this page's fetches to its own
  `/api` would be cross-origin and would need permissive CORS — and permissive
  CORS on this port is a filesystem enumeration oracle reachable from any tab.
  With a real origin there is no CORS involved at all.

## The MCP door

One tool, `tree`, at `/mcp`. It answers the question this module exists to
answer, in the same words the person sees, from the same code path.

```
$ curl -s -X POST http://127.0.0.1:7970/mcp -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":
        {"name":"tree","arguments":{"projectPath":"/path/to/project","depth":2}}}'
```

Depth defaults to 1 and is capped; ignored directories are listed and never
descended into, which is what keeps `node_modules` out of a deep read. There is
no search tool, deliberately — every agent on this canvas already has a file
search that is faster and respects more of git's rules, and a worse copy here
would mean two answers to one question.

## Layout

```
manifest.ts        what a host reads, and where every bound is written down
doors.ts           /api/tree, /mcp, /healthz — deciding, without a socket
vite.config.ts     the one server: page, manifest, api, mcp, one origin
run.sh             ./run.sh, no arguments, $PORT from the environment
register.ts        write ~/.roadmap/modules/roadmap.explorer.json

tree/confine.ts    the fence. the only file that decides what may be looked at
tree/ignore.ts     what git would ignore, as a pure function over a string
tree/read.ts       one directory, read once
tree/flatten.ts    the visible-node model. pure, and tested hardest
tree/paths.ts      a path said absolutely and relatively, in one place
tree/shape.ts      what an entry is, and every bound on a request

src/app.tsx        the page: the virtualizer, and the one press that points
src/use-tree.ts    what is open, what is loaded, and when it is re-read
src/lib/copy.ts    the clipboard, both ways, and what to do when neither works
src/view/row.tsx   one line
src/view/menu.tsx  the right-click menu: two copies and nothing else
src/view/place.ts  where a menu goes so all of it is inside a 220px frame
src/wire/          the host, as one React value

dev/measure.mjs    the numbers above, reproduced
dev/pointing.mjs   the bound on passage.set, watched from where a host sits
dev/copying.mjs    the clipboard, read back, framed and unframed
```
