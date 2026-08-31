import { afterEach, describe, expect, test } from 'bun:test'

import { copy } from '../src/lib/copy.ts'

/**
 * Both ways of reaching a clipboard, and the one thing that must never happen.
 *
 * ## Why these tests are written against stubs rather than a real clipboard
 *
 * Because there is no real clipboard in a test runner, and — more to the point
 * — because the case that broke was a browser REFUSING. `navigator.clipboard`
 * is gated by a permission policy whose default allowlist is `self`, and every
 * module in this workspace is cross-origin to its host, so the refusal is the
 * common case rather than the exotic one. What has to be asserted is what this
 * code does when the promise rejects, and a stub that rejects is a far more
 * faithful model of that than any browser a test could get hold of.
 *
 * The other half is asserted in `dev/copying.mjs`, which drives a real Chromium
 * inside a real frame and reads the real clipboard back. Neither test replaces
 * the other: this one covers the branches, that one covers the permission.
 *
 * ## The assertion that matters most
 *
 * That `failed` is returned, and returned as a value rather than thrown. A
 * rejected promise nobody looked at is indistinguishable from a copy that
 * worked, which is precisely the bug that produced this file — the menu item
 * highlights, the menu closes, and the person finds out at the paste.
 */

const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'clipboard', original)
  else Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'clipboard')
  Reflect.deleteProperty(document as unknown as Record<string, unknown>, 'execCommand')
  document.body.innerHTML = ''
})

/** Put a `navigator.clipboard` in place, or take it away entirely. */
function clipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
    writable: true,
  })
}

/**
 * Put a `document.execCommand` in place that reports what was selected.
 *
 * It reads the value off `document.activeElement`, which is exactly what a real
 * `execCommand('copy')` does with the selection — so a fallback that forgot to
 * focus or select would be caught here rather than passing on the strength of
 * having created a textarea somewhere.
 */
function execCommand(works: boolean, seen: string[]) {
  ;(document as unknown as { execCommand: (command: string) => boolean }).execCommand = (command: string) => {
    if (command !== 'copy') return false
    const focused = document.activeElement
    if (focused instanceof HTMLTextAreaElement) seen.push(focused.value)
    return works
  }
}

describe('the clipboard API path', () => {
  test('is used when it is allowed, and receives the text', async () => {
    const written: string[] = []
    clipboard(async (text) => {
      written.push(text)
    })
    expect(await copy('/Users/me/project/src/app.tsx')).toBe('clipboard')
    expect(written).toEqual(['/Users/me/project/src/app.tsx'])
  })

  /* No `.catch(() => {})` further out is allowed to be what handles this. The
     rejection is the browser saying no, and it has to become an answer. */
  test('a rejection is not thrown out of the call', async () => {
    clipboard(async () => {
      throw new Error('NotAllowedError')
    })
    execCommand(true, [])
    expect(await copy('x')).toBe('textarea')
  })
})

describe('the textarea fallback', () => {
  /*
   * The case this whole file exists for: a frame without
   * `allow="clipboard-write"`, where the modern API rejects on permission and
   * the deprecated one — which does not consult that policy — still works.
   */
  test('copies the same text when the clipboard API is refused', async () => {
    const seen: string[] = []
    clipboard(async () => {
      throw new Error('NotAllowedError')
    })
    execCommand(true, seen)
    expect(await copy('src/view/row.tsx')).toBe('textarea')
    expect(seen).toEqual(['src/view/row.tsx'])
  })

  test('is used when there is no clipboard API at all', async () => {
    const seen: string[] = []
    clipboard(null)
    execCommand(true, seen)
    expect(await copy('package.json')).toBe('textarea')
    expect(seen).toEqual(['package.json'])
  })

  /* A textarea left in the document would be a focusable, selectable element
     sitting invisibly over the corner of the tree forever. */
  test('leaves nothing behind in the document', async () => {
    clipboard(null)
    execCommand(true, [])
    await copy('a.ts')
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  /*
   * Focus goes back where it came from, which for a keyboard user is the row
   * they opened the menu on. Losing it drops them to `<body>` and loses their
   * place in a tree that may be thousands of rows long.
   */
  test('gives focus back to whatever had it', async () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()

    clipboard(null)
    execCommand(true, [])
    await copy('a.ts')

    expect(document.activeElement).toBe(button)
  })

  test('focus is restored even when the copy fails', async () => {
    const button = document.createElement('button')
    document.body.appendChild(button)
    button.focus()

    clipboard(null)
    execCommand(false, [])
    expect(await copy('a.ts')).toBe('failed')
    expect(document.activeElement).toBe(button)
  })
})

describe('when nothing works', () => {
  test('says so rather than looking like a success', async () => {
    clipboard(async () => {
      throw new Error('NotAllowedError')
    })
    execCommand(false, [])
    expect(await copy('a.ts')).toBe('failed')
  })

  test('says so when there is no mechanism at all', async () => {
    clipboard(null)
    expect(await copy('a.ts')).toBe('failed')
  })
})
