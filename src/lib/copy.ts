/**
 * Putting a string on the clipboard from inside a sandboxed cross-origin frame,
 * which is harder than it has any right to be and fails silently when it fails.
 *
 * ## The trap, written down because it cost a release
 *
 * `navigator.clipboard.writeText` is gated by the `clipboard-write` permission
 * policy, and that policy's DEFAULT ALLOWLIST IS `self`. Every module in this
 * workspace runs on its own port, and a different port is a different origin,
 * so every module frame is cross-origin to its host — which means the default
 * allowlist excludes all of them. Unless the host writes
 * `allow="clipboard-write"` on the iframe, the promise this returns REJECTS
 * with a `NotAllowedError`.
 *
 * That failure is invisible in the worst possible way. The menu item highlights,
 * the menu closes, nothing throws where anybody would see it, and the person
 * pastes yesterday's clipboard into a commit message. A rejected promise nobody
 * observed is indistinguishable from a copy that worked, right up until the
 * paste. The host now sends the attribute; this file exists so that a host that
 * does not — an older one, an unframed page opened straight on port 7970, a
 * browser that declines anyway — still copies.
 *
 * ## So: two mechanisms, tried in order, and the older one is not a courtesy
 *
 * 1. `navigator.clipboard.writeText`. Asynchronous, permission-gated, the one
 *    that is not deprecated, and the one that gets a proper answer out of a
 *    browser that has decided to say no.
 * 2. A `<textarea>` and `document.execCommand('copy')`. Deprecated for years,
 *    removed by nobody, and subject to a different rule: it needs the document
 *    to have transient user activation and needs a real selection, and it does
 *    NOT consult the clipboard permission policy at all. A menu item pressed by
 *    a person has the activation by construction, which is exactly why this
 *    fallback works in the case that defeats the first one.
 *
 * The order matters and is not arbitrary. The modern API first, because when it
 * works it is the one that behaves correctly with focus, with large strings and
 * with a browser's own clipboard-history features. The old one only when the
 * new one has actually said no, rather than pre-emptively on a user-agent
 * sniff — sniffing would mean the deprecated path is the one that runs
 * everywhere and the modern path is the one nobody has ever exercised.
 *
 * ## The return value is a fact, and callers are expected to look at it
 *
 * Not `void`, and not a thrown error. The caller has to be able to tell the
 * person when a copy did not happen, because "nothing visible happened" is the
 * complaint that produced this whole feature. It says WHICH mechanism worked as
 * well as whether one did, so a probe can assert on the fallback path directly
 * instead of inferring it from the absence of an exception.
 */

/** What happened. `failed` means nothing reached the clipboard and somebody has to be told. */
export type Copied = 'clipboard' | 'textarea' | 'failed'

/**
 * Put `text` on the clipboard, by whichever mechanism is allowed to.
 *
 * Must be called from inside a user gesture — a press handler, a menu
 * activation — and stays inside one: the `await` on the first attempt resolves
 * within the transient activation window (five seconds in every engine that
 * implements it), so the fallback still has the activation it needs. Deferring
 * either half behind a timer or a fetch is what breaks that, which is why
 * nothing here is scheduled.
 */
export async function copy(text: string): Promise<Copied> {
  if (await viaClipboard(text)) return 'clipboard'
  if (viaTextarea(text)) return 'textarea'
  return 'failed'
}

/**
 * The modern one.
 *
 * Every branch here is a real state rather than defensive noise: `navigator`
 * has no `clipboard` at all over plain HTTP on a non-loopback host, and the
 * `writeText` call rejects when the permission policy forbids it. Both mean the
 * same thing to the caller — try the other way — so both answer `false` rather
 * than throwing, and the rejection is swallowed HERE, where swallowing it is
 * the whole intent, instead of at a `.catch(() => {})` further out where it
 * would also swallow a bug.
 */
async function viaClipboard(text: string): Promise<boolean> {
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard || typeof clipboard.writeText !== 'function') return false
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * The old one: a textarea, selected, copied, and taken away again.
 *
 * ## Why a `<textarea>` and not a hidden `<div>`
 *
 * `execCommand('copy')` copies the current SELECTION, and a selection inside a
 * form control is the only kind an element can put there itself, in one call,
 * with no ranges to build. A textarea also preserves the string exactly —
 * whitespace, and any character a path is allowed to contain — where a div
 * would put it through HTML parsing on the way in.
 *
 * ## Why it is rendered rather than hidden
 *
 * `display: none` and `visibility: hidden` both remove the element from the
 * layout, and a browser will not select text in something it is not laying out;
 * the copy then quietly does nothing, which is the failure mode this file
 * exists to eliminate. So it is one pixel, transparent, fixed at the corner,
 * and gone again on the same frame. `readonly` keeps a mobile keyboard from
 * appearing during the blink it exists for, and does not prevent selection.
 *
 * ## The focus is put back
 *
 * Focusing the textarea moves focus off whatever the person was on — in this
 * app, a menu item inside a menu that is about to close and hand focus back to
 * the row. Leaving focus on a removed element drops it to `<body>`, and a
 * keyboard user who opened this menu with Shift+F10 would find their place in
 * the tree gone. So the previously focused element is remembered and restored
 * in a `finally`, including on the failure path.
 */
function viaTextarea(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false

  const wasFocused = document.activeElement
  const area = document.createElement('textarea')
  area.value = text
  area.readOnly = true
  area.tabIndex = -1
  area.setAttribute('aria-hidden', 'true')
  area.style.cssText =
    'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(area)

  try {
    area.focus({ preventScroll: true })
    area.select()
    /* Explicit as well as `select()`, because iOS Safari's `select()` on a
       readonly textarea has historically been a no-op and a copy of an empty
       selection succeeds while copying nothing. */
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy') === true
  } catch {
    return false
  } finally {
    area.remove()
    if (wasFocused instanceof HTMLElement) wasFocused.focus({ preventScroll: true })
  }
}
