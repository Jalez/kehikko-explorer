import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * A document, for the tests that render one.
 *
 * Registered globally rather than per-file because half the value of these
 * tests is that they run the real components — the words on screen are the
 * thing being asserted, and a fake renderer would let a component say something
 * different from what it says in a browser.
 */
GlobalRegistrator.register()

/**
 * A `ResizeObserver`, which happy-dom does not ship.
 *
 * Both the virtualizer and this app's own height measurement construct one at
 * mount, and without a global the render throws before a single row is drawn —
 * a component test that fails with `ResizeObserver is not defined` says nothing
 * about the component.
 *
 * It observes nothing and never fires, and that is the honest stub: a test that
 * asserted on a resize would be asserting on this file's behaviour rather than
 * on the app's. What the render tests check is what is on screen at a given
 * size, which is a matter of the elements and their classes.
 */
if (!('ResizeObserver' in globalThis)) {
  class Stub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = Stub
}
