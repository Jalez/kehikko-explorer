/**
 * What this container actually does at the sizes it actually gets.
 *
 * Kept rather than thrown away, because every number in the comments about
 * layout in this repository came out of it and a claim about a 220-pixel
 * container is worth exactly as much as the last time somebody measured one.
 *
 *   node dev/measure.mjs                        # against this module's own repo
 *   node dev/measure.mjs /path/to/a/big/project
 *
 * It needs `./run.sh` already running on 7970 and a headless Chromium. The
 * paths below are this machine's; change them or pass them in the environment.
 *
 * ## What it establishes, and why each one is a number rather than a look
 *
 * 1. **Nothing scrolls sideways, at any width.** The standing rule of this
 *    workspace. It is checked as `scrollWidth <= clientWidth` on the body and on
 *    the scroll container, because a screenshot of a container whose content is
 *    eleven pixels too wide looks exactly like one that fits.
 * 2. **Only the rows in view are in the DOM.** This is the whole claim of the
 *    virtualizer, and it is the one that silently stops being true when
 *    somebody changes the scroll container's height chain. Counted as rendered
 *    rows against total rows.
 * 3. **How long a directory takes to open**, on a directory big enough for the
 *    answer to mean something.
 *
 * It drives the page with no host at all: the greeting is posted onto the
 * page's own window in exactly the shape the protocol spells out, which works
 * because the client listens for a `message` rather than for a parent frame.
 * That is the whole of the setup — there is no fixture, no stub server and no
 * parameter the app does not have in production.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from '/Users/jaakkorajala/.claude/jobs/85f6bc23/tmp/node_modules/playwright/index.mjs'

const EXECUTABLE =
  process.env.CHROMIUM
  ?? '/Users/jaakkorajala/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const ORIGIN = process.env.EXPLORER_ORIGIN ?? 'http://127.0.0.1:7970'
const PROJECT = process.argv[2] ?? '/Users/jaakkorajala/Projects/kehikko-explorer'

/** The sizes a container on this canvas is actually given, including the cruel ones. */
const SIZES = [
  { width: 220, height: 300 },
  { width: 320, height: 200 },
  { width: 460, height: 360 },
  { width: 900, height: 700 },
]

/**
 * The greeting, posted the way a host posts it.
 *
 * The page listens at module scope for exactly this — see the essay in
 * `src/main.tsx` — so it has to arrive as a `message` on the window with the
 * shape the protocol spells out. Sending it from inside the page rather than
 * from a parent frame is what lets this run without a host.
 */
const hello = (project) => `
  window.postMessage({
    type: 'roadmap.hello',
    protocol: 2,
    session: 'measure',
    state: null,
    context: {
      epic: null,
      project: 'measured',
      projectPath: ${JSON.stringify(project)},
      theme: 'light',
      passage: null,
      prompt: null,
    },
  }, '*')
`

const browser = await chromium.launch({ executablePath: EXECUTABLE })
const results = []

for (const size of SIZES) {
  const context = await browser.newContext({ viewport: size })
  const page = await context.newPage()
  /* Never `networkidle`: this is a Vite dev server with an open hot-reload
     socket, so the network is never idle and the wait is a timeout. */
  await page.goto(`${ORIGIN}/app`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(hello(PROJECT))
  await page.waitForSelector('[data-testid="row"]', { timeout: 5000 })

  const rowCount = await page.locator('[data-testid="row"]').count()

  /* Open every directory on screen, one level, and time the last one. */
  const chevrons = await page.locator('[data-testid="chevron"]').all()
  const opened = performance.now()
  for (const chevron of chevrons) await chevron.click()
  await page.waitForFunction(
    (before) => document.querySelectorAll('[data-testid="row"]').length !== before,
    rowCount,
    { timeout: 5000 },
  )
  const openMs = Math.round(performance.now() - opened)

  const measured = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="scroller"]')
    const inner = scroller?.firstElementChild
    return {
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      scrollerScrollWidth: scroller?.scrollWidth ?? 0,
      scrollerClientWidth: scroller?.clientWidth ?? 0,
      scrollerHeight: scroller?.clientHeight ?? 0,
      /* Total rows, as the virtualizer sized its spacer, over rows actually in
         the DOM. The ratio is the whole point of virtualizing. */
      totalHeight: inner ? Number.parseInt(inner.style.height, 10) : 0,
      inDom: document.querySelectorAll('[data-testid="row"]').length,
      widest: Math.max(
        0,
        ...[...document.querySelectorAll('[data-testid="row"]')].map((el) => el.scrollWidth),
      ),
    }
  })

  const totalRows = Math.round(measured.totalHeight / 22)
  results.push({
    size: `${size.width}x${size.height}`,
    rows: totalRows,
    inDom: measured.inDom,
    scrollerHeight: measured.scrollerHeight,
    openMs,
    bodyOverflowsX: measured.bodyScrollWidth > measured.bodyClientWidth,
    scrollerOverflowsX: measured.scrollerScrollWidth > measured.scrollerClientWidth,
    widestRow: measured.widest,
  })

  await context.close()
}

/*
 * The scale pass, and the number the whole design rests on.
 *
 * Everything above is a repository's tracked files, which is a few dozen rows —
 * enough to prove the layout and not enough to prove the virtualizer. A real
 * `node_modules` is bigger but not reliably so: the one on this machine is 157
 * entries, which any renderer survives.
 *
 * So this builds twenty thousand names in a temporary directory and points the
 * container at it, in the narrowest container the canvas gives out. That is a
 * synthetic tree and it is deliberately synthetic: the question is what the
 * RENDERER does with twenty thousand rows, and a directory somebody happens to
 * have is a worse instrument than one with a known size. Nothing about the
 * ignore rules or the confinement is being measured here — those have their own
 * tests against real trees.
 */
const huge = mkdtempSync(join(tmpdir(), 'explorer-scale-'))
for (let i = 0; i < 20_000; i += 1) writeFileSync(join(huge, `file-${String(i).padStart(5, '0')}.ts`), '')

const deep = await browser.newContext({ viewport: { width: 220, height: 300 } })
const deepPage = await deep.newPage()
const started = performance.now()
await deepPage.goto(`${ORIGIN}/app`, { waitUntil: 'domcontentloaded' })
await deepPage.evaluate(hello(huge))
await deepPage.waitForSelector('[data-testid="row"]', { timeout: 20_000 })
const readMs = Math.round(performance.now() - started)

/* Jump to the middle and time it, because a virtualizer that is correct at rest
   and slow to scroll is a virtualizer nobody wants. */
const scrolled = performance.now()
await deepPage.evaluate(() => {
  const el = document.querySelector('[data-testid="scroller"]')
  el.scrollTop = el.scrollHeight / 2
})
await deepPage.waitForTimeout(100)
const scrollMs = Math.round(performance.now() - scrolled) - 100

const scale = await deepPage.evaluate(() => ({
  rows: Math.round(document.querySelector('[data-testid="scroller"] > div').clientHeight / 22),
  inDom: document.querySelectorAll('[data-testid="row"]').length,
  overflowsX: document.body.scrollWidth > document.body.clientWidth,
}))
scale.readMs = readMs
scale.scrollMs = scrollMs
await deep.close()
rmSync(huge, { recursive: true, force: true })

await browser.close()
console.log(`project: ${PROJECT}`)
console.table(results)

const broken = results.filter((one) => one.bodyOverflowsX || one.scrollerOverflowsX)
if (broken.length) {
  console.error(`HORIZONTAL OVERFLOW at ${broken.map((one) => one.size).join(', ')}`)
  process.exit(1)
}
console.log('no horizontal overflow at any size')
console.log(
  `scale: a 20,000-entry directory at 220x300 — ${scale.rows} rows, ${scale.inDom} in the DOM, `
  + `${scale.readMs}ms from navigation to first row, ${scale.scrollMs}ms to jump to the middle, `
  + `${scale.overflowsX ? 'HORIZONTAL OVERFLOW' : 'no horizontal overflow'}`,
)
if (scale.overflowsX) process.exit(1)
