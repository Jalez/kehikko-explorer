#!/usr/bin/env bun
import { buildModule } from 'kehikot-module-protocol/build'

import { PAGE_HEAD } from './page.ts'

/**
 * The page, compiled ahead of time for `serve.ts`, and stamped with the commit.
 *
 *   bun run build
 *
 * The document is the protocol's `pageDocument` — the one the dev server
 * generates — written to `index.html` for the build and taken away after. The
 * stamp (`dist/.kehikot-built`) is written only after a build that succeeded
 * from a checkout with no changes to tracked files; an edited checkout's build
 * is not stamped, and `run.sh` keeps Vite for it.
 */
const built = await buildModule({ dir: import.meta.dirname, page: { title: 'Explorer', head: PAGE_HEAD } })
if (!built.stamped) process.exitCode = 2
