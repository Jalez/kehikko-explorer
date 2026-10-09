#!/usr/bin/env bun
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { originFor, registerAt } from 'kehikot-module-protocol/serve'

import { ID, PREFERRED_PORT } from './manifest.ts'

/**
 * Tell a host on this machine where this app answers.
 *
 *   bun run register            # or: PORT=7970 bun run register
 *
 * A separate program from `run.sh` on purpose. Registration writes into
 * somebody's home directory and says "frame this", which is a decision a person
 * makes once; a start script that did it quietly would be making that decision
 * on their behalf every time they pressed start.
 *
 * ## The filename is the module id
 *
 * Not a field inside the file — the NAME. A host sweeps the directory and takes
 * the id from the filename, so `kehikot.explorer.json` is what makes this
 * `kehikot.explorer`. Two files naming the same port under different names are
 * two modules as far as a host is concerned.
 *
 * ## `dir` as well as `url`
 *
 * The url is where to talk to this app; the directory is where to start it. A
 * host that has only the first can frame a running module and can do nothing at
 * all about a stopped one, which in practice means a container saying "nothing
 * is answering" beside a Start button that is not there. With both, the host
 * runs `run.sh` inside this directory — one script, no arguments, for the reason
 * that file gives.
 *
 * It is this file's own location rather than a string, so a checkout moved or
 * cloned somewhere else registers itself correctly by being run.
 *
 * ## Where a host looks
 *
 * That is `registerAt`'s business, not this file's: the protocol package knows
 * the registry directory (`~/Library/Application Support/Kehikot/modules`, or
 * `$KEHIKOT_MODULES_DIR`), and a copy of that path here is one more chance to
 * disagree with a host by a character.
 */

/**
 * 7970, and the number is not arbitrary.
 *
 * 7820 through 7960 are the other modules on this machine. A module that
 * defaulted to a port somebody else had would answer nothing, or worse, would
 * fail to start while its neighbour went on serving a page the host attributed
 * to this one. It is `PREFERRED_PORT` in `manifest.ts`, the same constant
 * `serves()` in `vite.config.ts` starts from, so the two cannot drift.
 *
 * `serves()` rewrites this same file every time the server starts, with the
 * port it actually bound. That keeps the ADDRESS true; running this program is
 * still how a person ADOPTS the module in the first place.
 */
const port = Number(process.env.PORT ?? PREFERRED_PORT)
const written = registerAt({
  id: ID,
  origin: originFor(port),
  dir: dirname(fileURLToPath(import.meta.url)),
})

console.log(`registered: ${written.file} -> ${written.url} (${written.dir})`)
if (written.was) console.log(`  (was ${written.was.url} in ${written.was.dir})`)
console.log('Start the app with ./run.sh, then reload the host; it sweeps the directory on every read.')
