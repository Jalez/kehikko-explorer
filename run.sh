#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - $PORT from the environment. Whoever starts this chose the port, and
#     `serves()` in `vite.config.ts` reads it; without one it prefers 7970
#     (`PREFERRED_PORT` in `manifest.ts`) and, if something else has that,
#     moves to the next free port and says so.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so `node_modules` and Vite's config
#     are found however the script was invoked. Nothing else depends on the
#     working directory: this app opens no file of its own and keeps no store.
#
# It does not ADOPT the module on anybody's behalf — that is `register.ts`, a
# deliberate act by a person. What `serves()` does on every start is keep the
# ADDRESS of the registration true: it writes the port it actually bound.
#
# ## The built page, when it is this checkout's, and Vite otherwise
#
# There is a build: `bun run build` compiles the page into `dist/` and stamps it
# with the commit (`dist/.kehikot-built`), and `serve.ts` serves it on the same
# doors and the same port, with a fraction of the memory a Vite dev server holds.
# A host builds an installed copy when it installs or updates it, at the tag; a
# start never builds, because a start that builds is a start that fails when the
# network is down.
#
# The old objection to a `dist` here was the right one: a STALE page served with
# a 200 has every symptom of a working app and none of the changes, and that has
# cost this codebase whole afternoons. So the built page is served only when its
# stamp is the commit checked out here, which is checked at the bottom of this
# file before anything is started. A checkout somebody edits has no stamp, or one
# of an older commit, and gets Vite as it always did; a build of an edited tree is
# never stamped. `serve.ts` refuses a stale build itself too (a 503 that says
# why), so even `bun run start` by hand cannot serve one.
#
# On the Vite path the manifest, the health check, the MCP door and this app's
# own store are middleware in front of the same server — see `doors()` in
# `vite.config.ts` — because a module is one origin or it is nothing.
set -euo pipefail
cd "$(dirname "$0")"

# Which directories this app may be pointed at, when an operator wants to say.
#
# Colon-separated, absolute paths only. Unset is the default: the root arrives
# in `context.projectPath` from the host, the page sends it with this process's
# ticket, and a project the page has named is what the app serves. Never the
# disk's root or a home folder.
#
# Set it, and the list is the rule instead: a root inside one of the directories
# is served and anything else is refused. The essay on `rootOf` in
# `tree/confine.ts` says exactly what each state does and does not promise.
#
# What it never affects is the OTHER fence, which is unconditional: whatever the
# root is, no path in any request can leave it. That one is not configurable and
# must not become so.
: "${EXPLORER_ROOTS:=}"
export EXPLORER_ROOTS

# Install when nothing is installed, AND whenever bun.lock or package.json is
# newer than the last install here — the same rule as the host's own run.sh. A
# pull that moves the protocol pin leaves the old package in node_modules, and
# a page that imports a name the old package does not have draws nothing.
# `--frozen-lockfile`, so a start installs exactly what bun.lock says and never
# rewrites it behind somebody's back. The stamp is written only after an
# install that succeeded.
INSTALLED=node_modules/.kehikot-installed
VITE_FORCE=
if [ ! -d node_modules ] || [ ! -f "$INSTALLED" ] || [ bun.lock -nt "$INSTALLED" ] || [ package.json -nt "$INSTALLED" ]; then
  echo "installing…" >&2
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile >&2 || { echo "bun install --frozen-lockfile failed: bun.lock does not match package.json. Run \`bun install\` and commit bun.lock." >&2; exit 1; }
  else
    bun install >&2
  fi
  touch "$INSTALLED"
  # Rebuild Vite's pre-bundle rather than trust one made from the old packages.
  VITE_FORCE=--force
fi

# The built page, when its stamp is this checkout's HEAD (`bun run build`, which a
# host runs at install and update, never at start). Read here, in the shell, so
# choosing costs a `git rev-parse` and not a process. A checkout somebody edits
# has no stamp, or one of an older commit, and gets Vite; a stale build is never
# served (`serve.ts` refuses one too, with a 503 that says why).
BUILT=
if [ -f dist/.kehikot-built ] && [ -f dist/index.html ]; then
  read -r BUILT < dist/.kehikot-built || true
fi
if [ -n "$BUILT" ] && [ "$BUILT" = "$(git rev-parse HEAD 2>/dev/null)" ]; then
  exec bun run serve.ts
fi
if [ -n "$BUILT" ]; then
  echo "explorer: dist/ is a build of ${BUILT:0:7}, not of this checkout, so Vite serves the page. \`bun run build\` would make it current." >&2
fi

exec bunx vite $VITE_FORCE
