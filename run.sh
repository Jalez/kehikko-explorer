#!/usr/bin/env bash
#
# The one name every module ships this under, so a host that offers to start one
# has a script to run rather than a command line to build.
#
#   - No arguments. A registration names a directory and one script inside it,
#     never a command line: a string a host handed to a shell would make a
#     registration file a place to write shell.
#   - $PORT from the environment. Whoever starts this chose the port; a script
#     that picked its own would answer somewhere nobody is looking. 7970 is the
#     default and it is the number in `register.ts` too — 7820 through 7960
#     belong to the other modules on this machine.
#   - `exec`, and the foreground. A script that forks and returns leaves whoever
#     started it holding a pid that stops nothing, and Stop is only ever offered
#     for what a host started.
#   - `cd` to this script's own directory, so `node_modules` and Vite's config
#     are found however the script was invoked. Nothing else depends on the
#     working directory: this app opens no file of its own and keeps no store.
#
# It does NOT register. Registration is a deliberate act by a person — see
# `register.ts` — and a start script that quietly wrote into somebody's home
# directory would be doing it on their behalf.
#
# ## There is no build here, and no `dist`
#
# What `dist` buys is a STALE page served with a 200: every symptom of a working
# app and none of the changes. That failure has cost this workspace whole
# afternoons in three separate programs. A missing build announces itself; a
# stale one does not. So Vite serves the page, and the manifest, the health
# check, the MCP door and this app's `/api` are middleware in front of the same
# server — see `doors()` in `vite.config.ts` — because a module is one origin or
# it is nothing.
set -euo pipefail
cd "$(dirname "$0")"

# Which directories this app may be pointed at, or none, meaning any.
#
# Colon-separated, absolute paths only. Unset is the default and it is an honest
# default rather than a lax one: the root arrives in `context.projectPath` from
# the host, and a module that refused the project the host just opened would be
# a container permanently saying no to the only question it is asked.
#
# Set it, and a request naming a root outside every configured directory is
# refused — which turns "the caller picks the root" into "the caller picks among
# the directories the operator allowed". The essay on `rootOf` in
# `tree/confine.ts` says exactly what each state does and does not promise.
#
# What it never affects is the OTHER fence, which is unconditional: whatever the
# root is, no path in any request can leave it. That one is not configurable and
# must not become so.
: "${EXPLORER_ROOTS:=}"
export EXPLORER_ROOTS

if [ ! -d node_modules ]; then
  echo "installing…" >&2
  bun install >&2
fi

exec bunx vite --host 127.0.0.1 --port "${PORT:-7970}" --strictPort
