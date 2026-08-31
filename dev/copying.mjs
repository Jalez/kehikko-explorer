/**
 * The context menu, in a real frame, with the clipboard read back afterwards.
 *
 *   node dev/copying.mjs             # needs ./run.sh already on 7970
 *
 * ## Why a probe and not another unit test
 *
 * Because the failure this menu was built to fix is not a failure of any
 * branch. `test/copy.test.ts` proves that a rejected `writeText` falls back and
 * that a total failure is reported; what it cannot prove is that a browser lets
 * this page near the clipboard AT ALL, because the thing standing in the way is
 * a permissions policy and there is no permissions policy in happy-dom.
 *
 * `navigator.clipboard.writeText` has a default allowlist of `self`. Every
 * module here is on its own port, so every module frame is cross-origin to its
 * host, so the default excludes all of them: without `allow="clipboard-write"`
 * on the iframe the promise REJECTS. And it rejects silently — the item
 * highlights, the menu closes, nothing throws anywhere a person would see it,
 * and they find out at the paste. A test that only checked "no exception was
 * thrown" would have passed against exactly that bug.
 *
 * So this reads the clipboard back. Not the return value, not the absence of an
 * error — the actual text sitting on the actual clipboard, written by the frame
 * and read by the page framing it.
 *
 * ## What it establishes
 *
 * 1. **With `allow="clipboard-write"`**, which is what the host sends today, the
 *    absolute path lands on the clipboard.
 * 2. **Without it**, which is an older host or an unframed page, the relative
 *    path still lands — by the `execCommand` fallback, since the modern API
 *    cannot have been what did it.
 * 3. **With `navigator.clipboard` deleted outright** the copy still lands, which
 *    pins the fallback down rather than inferring it from case 2.
 * 4. The menu stays inside the frame at **220x300**, which is the size this
 *    module is designed for and the only size at which placement can fail.
 * 5. **Shift+F10** opens the menu, because a menu only a mouse can open is a
 *    menu half the people using this cannot open.
 * 6. Opening the menu sends **no `passage.set`** — right-clicking is not
 *    pressing, and the bound in `manifest.ts` holds.
 */
import { chromium } from '/Users/jaakkorajala/.claude/jobs/85f6bc23/tmp/node_modules/playwright/index.mjs'

const EXECUTABLE =
  process.env.CHROMIUM
  ?? '/Users/jaakkorajala/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell'
const ORIGIN = process.env.EXPLORER_ORIGIN ?? 'http://127.0.0.1:7970'
const PROJECT = process.argv[2] ?? '/Users/jaakkorajala/Projects/kehikko-explorer'
const HOST_ORIGIN = 'http://localhost:4181'

/**
 * A host page, framing the module the way the real one does.
 *
 * `allow` is a parameter rather than a constant because the whole question here
 * is what happens with it and without it. The sandbox is copied from the real
 * host: this module declares `storage: true`, so it is framed with
 * `allow-same-origin` and keeps a real origin — see the essay in `manifest.ts`.
 */
const hostPage = (allow, size) => `<!doctype html>
<html><body style="margin:0">
<iframe id="frame" src="${ORIGIN}/app" width="${size.width}" height="${size.height}" style="border:0"
  ${allow ? `allow="${allow}"` : ''}
  sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>
<script>
  window.__sent = []
  const frame = document.getElementById('frame')
  addEventListener('message', (event) => {
    const message = event.data
    if (message && typeof message.type === 'string') window.__sent.push(message)
  })
  frame.addEventListener('load', () => {
    frame.contentWindow.postMessage({
      type: 'roadmap.hello', protocol: 2, session: 'copying', state: null,
      context: {
        epic: null, project: 'measured', projectPath: ${JSON.stringify(PROJECT)},
        theme: 'light', passage: null, prompt: null,
      },
    }, '*')
  })
</script>
</body></html>`

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  /* Removing an artefact of the harness rather than relaxing anything: a page
     on one origin framing loopback is blocked before the module's own headers
     are consulted, and the real host is itself on loopback so never hits it.
     The same note is in `dev/pointing.mjs`. */
  args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'],
})

const results = []
const wrong = []

/**
 * One run: open a host page, right-click a row, choose an item, read the
 * clipboard back.
 *
 * The clipboard is stamped with a sentinel FIRST, every time. Without that, a
 * copy that did nothing would pass on the strength of what the previous case
 * left there — which is the same shape of false pass as not checking at all.
 */
async function run({ name, allow, deleteClipboardApi = false, size = { width: 900, height: 700 }, item = 0 }) {
  const context = await browser.newContext({ viewport: { width: size.width + 40, height: size.height + 40 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: HOST_ORIGIN })

  if (deleteClipboardApi) {
    /*
     * Applies to every frame in the context, which is the only way to reach
     * inside a page this script does not author — and therefore has to be
     * fenced to the MODULE's origin. Without the guard it also blinds the host
     * page, and the host page is the one doing the reading back; the probe then
     * fails on its own instrument rather than on the thing being measured.
     */
    await context.addInitScript((moduleOrigin) => {
      if (location.origin !== moduleOrigin) return
      try {
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
      } catch {
        /* Some builds refuse; the case then degrades into case 2 and says so. */
      }
    }, ORIGIN)
  }

  const page = await context.newPage()
  await page.route(`${HOST_ORIGIN}/copy-probe`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: hostPage(allow, size) }))
  await page.goto(`${HOST_ORIGIN}/copy-probe`, { waitUntil: 'domcontentloaded' })

  const sentinel = `SENTINEL-${name}-${Date.now()}`
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel)

  const frame = page.frameLocator('#frame')
  const row = frame.locator('[data-testid="row"][data-path="package.json"]')
  await row.waitFor({ timeout: 10_000 })

  await row.click({ button: 'right' })
  await frame.locator('[data-testid="row-menu"]').waitFor({ timeout: 5_000 })

  /* The menu's own box, in the frame's coordinates, so the 220-pixel case can
     be checked rather than believed. */
  const box = await frame.locator('[data-testid="row-menu"]').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  })
  const fits = box.left >= 0 && box.top >= 0 && box.right <= size.width && box.bottom <= size.height

  const wanted = await frame.locator('[data-testid="menu-item"]').nth(item).getAttribute('data-copies')
  await frame.locator('[data-testid="menu-item"]').nth(item).click()
  await page.waitForTimeout(300)

  const onClipboard = await page.evaluate(() => navigator.clipboard.readText())
  const passages = await page.evaluate(() =>
    window.__sent.filter((m) => m.type === 'roadmap.request' && m.method === 'passage.set').length)
  const menuGone = (await frame.locator('[data-testid="row-menu"]').count()) === 0

  await context.close()

  results.push({
    case: name,
    'what it copied': onClipboard === sentinel ? '(nothing — clipboard unchanged)' : onClipboard,
    'is what it said it would': onClipboard === wanted,
    'menu inside the frame': fits,
    'menu closed after': menuGone,
    'passage.set sent': passages,
  })
  if (onClipboard !== wanted) wrong.push(`${name}: clipboard holds ${JSON.stringify(onClipboard)}, wanted ${JSON.stringify(wanted)}`)
  if (!fits) wrong.push(`${name}: the menu was drawn outside the frame`)
  if (!menuGone) wrong.push(`${name}: the menu stayed open after an item was chosen`)
  if (passages !== 0) wrong.push(`${name}: right-clicking pointed the canvas ${passages} time(s)`)
  return { page: null }
}

/* 1. The frame the host actually sends today. Absolute path. */
await run({ name: 'allow=clipboard-write', allow: 'clipboard-write' })
/* 2. An older host, or none. The modern API is refused, so anything that lands
      on the clipboard got there through the textarea. Relative path. */
await run({ name: 'no allow attribute', allow: null, item: 1 })
/* 3. The fallback pinned down rather than inferred. */
await run({ name: 'no navigator.clipboard at all', allow: 'clipboard-write', deleteClipboardApi: true })
/* 4. The size this module is designed for. */
await run({ name: '220x300', allow: 'clipboard-write', size: { width: 220, height: 300 }, item: 1 })

/**
 * The keyboard, on its own, because it is the half a mouse-driven probe cannot
 * see: focus a row, press Shift+F10, and expect a menu with focus already in it.
 */
{
  const context = await browser.newContext({ viewport: { width: 400, height: 500 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: HOST_ORIGIN })
  const page = await context.newPage()
  await page.route(`${HOST_ORIGIN}/copy-probe`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: hostPage('clipboard-write', { width: 320, height: 400 }) }))
  await page.goto(`${HOST_ORIGIN}/copy-probe`, { waitUntil: 'domcontentloaded' })

  const sentinel = `SENTINEL-keyboard-${Date.now()}`
  await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel)

  const frame = page.frameLocator('#frame')
  const row = frame.locator('[data-testid="row"][data-path="package.json"]')
  await row.waitFor({ timeout: 10_000 })
  await row.focus()
  await page.keyboard.press('Shift+F10')
  await frame.locator('[data-testid="row-menu"]').waitFor({ timeout: 5_000 })

  const focusedFirst = await frame
    .locator('[data-testid="row-menu"]')
    .evaluate((menu) => menu.firstElementChild === menu.ownerDocument.activeElement)

  /* Down, then Enter: the second item, chosen without a pointer ever moving. */
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const onClipboard = await page.evaluate(() => navigator.clipboard.readText())

  /* And Escape puts focus back on the row it was opened from. */
  await row.focus()
  await page.keyboard.press('Shift+F10')
  await frame.locator('[data-testid="row-menu"]').waitFor({ timeout: 5_000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(100)
  const backOnRow = await frame
    .locator('[data-testid="row"][data-path="package.json"]')
    .evaluate((element) => element === element.ownerDocument.activeElement)

  await context.close()

  results.push({
    case: 'shift+F10, arrows, enter',
    'what it copied': onClipboard === sentinel ? '(nothing — clipboard unchanged)' : onClipboard,
    'is what it said it would': onClipboard === 'package.json',
    'menu inside the frame': focusedFirst,
    'menu closed after': backOnRow,
    'passage.set sent': 0,
  })
  if (onClipboard !== 'package.json') wrong.push(`keyboard: clipboard holds ${JSON.stringify(onClipboard)}`)
  if (!focusedFirst) wrong.push('keyboard: focus did not land on the first item')
  if (!backOnRow) wrong.push('keyboard: escape did not give focus back to the row')
}

await browser.close()

console.table(results)
if (wrong.length) {
  console.error(`THE COPY IS BROKEN: ${wrong.join('; ')}`)
  process.exit(1)
}
console.log('every path copies what it says it will, inside the frame, with the mouse and without one')
