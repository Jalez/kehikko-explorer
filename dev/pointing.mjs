/**
 * The one thing this module asks permission for, watched from the host's side.
 *
 *   node dev/pointing.mjs            # needs ./run.sh already on 7970
 *
 * `manifest.ts` declares `passage:set` and then spends a page bounding it:
 * this app points when a person presses a file, and never otherwise — not on
 * load, not on a context, not when a directory finishes reading, not on any
 * conclusion it reached by itself. That bound is a claim about runtime
 * behaviour, and the only honest way to check a claim about runtime behaviour
 * is to sit where the host sits and count what arrives.
 *
 * So this page IS a host: it frames `/app`, greets it, records every
 * `roadmap.request` the frame sends, and then does the things that must NOT
 * produce one before doing the one thing that must.
 *
 * ## What it establishes
 *
 * 1. Loading, greeting, and expanding directories produce ZERO `passage.set`.
 * 2. Pressing a FILE produces exactly one, with the absolute path, and with
 *    `from`, `to` and `page` null — a passage naming a document with nothing
 *    selected in it, which is what pressing a filename means and all this
 *    module is entitled to claim about a file it has never opened.
 * 3. Pressing a DIRECTORY produces none. A folder is not a document.
 */
import { chromium } from '/Users/jaakkorajala/.claude/jobs/85f6bc23/tmp/node_modules/playwright/index.mjs'

const EXECUTABLE =
  process.env.CHROMIUM
  ?? '/Users/jaakkorajala/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const ORIGIN = process.env.EXPLORER_ORIGIN ?? 'http://127.0.0.1:7970'
const PROJECT = process.argv[2] ?? '/Users/jaakkorajala/Projects/kehikko-explorer'

/**
 * A host, in one document.
 *
 * ## It greets on `load`, and that order is not interchangeable
 *
 * The obvious version greets when `roadmap.ready` arrives, and it waits
 * forever: the client sends `ready` in ANSWER to a greeting, naming the
 * protocol it was greeted with, so a host waiting for one is two programs each
 * waiting for the other. A real host greets on the frame's `load` event, which
 * is exactly why the client installs its listener at module scope — see the
 * essay in `src/main.tsx`.
 *
 * ## It does not answer `passage.set`
 *
 * What is being measured is what the module SENDS. A module that behaved
 * differently depending on whether its request was granted would be a different
 * bug, and one worth finding separately.
 */
const HOST = `<!doctype html>
<html><body style="margin:0">
<iframe id="frame" src="${ORIGIN}/app" width="320" height="400" style="border:0"
  sandbox="allow-scripts allow-same-origin"></iframe>
<script>
  window.__sent = []
  const frame = document.getElementById('frame')
  addEventListener('message', (event) => {
    const message = event.data
    if (!message || typeof message.type !== 'string') return
    window.__sent.push(message)
  })
  frame.addEventListener('load', () => {
    frame.contentWindow.postMessage({
      type: 'roadmap.hello',
      protocol: 2,
      session: 'pointing',
      state: null,
      context: {
        epic: null,
        project: 'measured',
        projectPath: ${JSON.stringify(PROJECT)},
        theme: 'light',
        passage: null,
        prompt: null,
      },
    }, '*')
  })
</script>
</body></html>`

/*
 * Local Network Access is turned off for this run, and only for this run.
 *
 * Chrome refuses a page on one origin framing `127.0.0.1` unless the loopback
 * server opts in, and answers `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`
 * before the module's own headers are ever consulted. The real host is itself
 * on loopback, so it does not hit this; a probe whose host page is synthesised
 * by the test runner does. Disabling the check is therefore removing an
 * artefact of the harness, not relaxing anything the module relies on — its
 * own `frame-ancestors` is still enforced, which is why the host page below is
 * served from an origin that header names.
 */
const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'],
})
const context = await browser.newContext({ viewport: { width: 400, height: 500 } })
const page = await context.newPage()

/* Served from an origin this module's own `frame-ancestors` header allows.
   Synthesised in the browser rather than served, so nothing has to be listening
   on 4181 — and the CSP is still doing its job, which is the point of using an
   allowed origin rather than an invented one. */
await page.route('http://localhost:4181/explorer-probe', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: HOST }))
await page.goto('http://localhost:4181/explorer-probe', { waitUntil: 'domcontentloaded' })

const frame = page.frameLocator('#frame')
await frame.locator('[data-testid="row"]').first().waitFor({ timeout: 10_000 })

const passages = () =>
  page.evaluate(() => window.__sent.filter((m) => m.type === 'roadmap.request' && m.method === 'passage.set'))

const afterLoad = await passages()

/* Expanding a directory must not point at anything. */
await frame.locator('[data-testid="chevron"]').first().click()
await page.waitForTimeout(300)
const afterExpand = await passages()

/* Pressing a directory row must not point at anything either. */
const dirRow = frame.locator('[data-testid="row"][data-path="src"]')
if (await dirRow.count()) {
  await dirRow.click()
  await page.waitForTimeout(300)
}
const afterDirPress = await passages()

/* Pressing a FILE must point, exactly once. */
await frame.locator('[data-testid="row"][data-path="package.json"]').click()
await page.waitForTimeout(300)
const afterFilePress = await passages()

/*
 * And the other direction, which is the half a press-counting probe would
 * miss: a passage arriving from the canvas has to MARK the row.
 *
 * A real host answers `passage.set` by broadcasting a new context to every
 * framed module, including the one that asked. This one never answered, so the
 * context is sent by hand — which also proves the marking is driven by the
 * context rather than by a memory of what this page just asked for. Those are
 * not the same thing, and only one of them is correct when the host refuses.
 */
await page.evaluate((project) => {
  /* Flat, not nested under `context`. The greeting wraps its context in a
     field and `roadmap.context` IS the context with two envelope fields added,
     which is a difference that costs an afternoon if you assume symmetry. */
  document.getElementById('frame').contentWindow.postMessage({
    type: 'roadmap.context',
    protocol: 2,
    epic: null,
    project: 'measured',
    projectPath: project,
    theme: 'light',
    passage: { path: `${project}/package.json`, page: null, from: null, to: null, quoted: '' },
    prompt: null,
  }, '*')
}, PROJECT)
await page.waitForTimeout(300)

const marked = await frame.locator('[data-testid="row"][data-path="package.json"]').evaluate(
  (el) => el.parentElement.className.includes('bg-pointed'),
)

await browser.close()

const last = afterFilePress.at(-1)
const report = {
  'passage.set after load and greeting': afterLoad.length,
  'passage.set after expanding a directory': afterExpand.length,
  'passage.set after pressing a directory': afterDirPress.length,
  'passage.set after pressing a file': afterFilePress.length,
  'the path sent': last?.params?.passage?.path ?? null,
  'the range sent': last ? `${last.params.passage.from} … ${last.params.passage.to}` : null,
  'the page sent': last?.params?.passage?.page ?? null,
  'the quote sent': JSON.stringify(last?.params?.passage?.quoted ?? null),
  'the row is marked when the canvas points back': marked,
}
console.table(report)

const wrong = []
if (afterLoad.length !== 0) wrong.push('pointed on load or greeting')
if (afterExpand.length !== 0) wrong.push('pointed on expanding a directory')
if (afterDirPress.length !== 0) wrong.push('pointed on pressing a directory')
if (afterFilePress.length !== 1) wrong.push(`pressing one file sent ${afterFilePress.length} passages`)
if (last && (last.params.passage.from !== null || last.params.passage.to !== null)) {
  wrong.push('sent a byte range for a file it has never opened')
}
if (!marked) wrong.push('a passage from the canvas did not mark the row')
if (wrong.length) {
  console.error(`THE BOUND IS BROKEN: ${wrong.join('; ')}`)
  process.exit(1)
}
console.log('points only on a file press, with no range, and marks the row the canvas points at')
