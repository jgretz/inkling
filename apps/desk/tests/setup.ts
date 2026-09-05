/**
 * DOM and React test environment for render-based suites.
 *
 * Every render test file does, as its first import:
 *
 *   import {autoCleanup} from '../setup.ts';
 *   ...other imports...
 *   autoCleanup();
 *
 * `autoCleanup()` wires three things **per file**, which is the point. A
 * top-level hook in this module would be scoped to whichever file imported it
 * first, and every other suite would inherit that file's state instead of
 * having its own.
 *
 * 1. `beforeAll` registers happy-dom, so `document` and `window` exist.
 * 2. `afterEach` runs cleanup, so one test's renders cannot leak into the next.
 * 3. `afterAll` drains React's scheduler, then **unregisters** happy-dom.
 *
 * That third step is not tidiness. `GlobalRegistrator.register()` replaces the
 * globals wholesale, `fetch` among them, and every test file in a run shares one
 * process. Left registered, a DOM suite hands its `Window.fetch` to whatever
 * runs next, and a suite that speaks HTTP for real fails inside happy-dom's
 * fetch with an error naming a file that has nothing to do with a DOM.
 * Registering per file and handing the globals back keeps the blast radius to
 * the file that asked for a DOM.
 *
 * A file only ever unregisters what it registered. `scripts/dom-setup.ts`
 * registers once at preload, so in the normal `bun run test` run no file
 * registers and no file unregisters; the per-file path is what a bare
 * `bun test` on a single suite still gets. Unregistering unconditionally is
 * what broke: the first DOM suite handed back globals it never took, and every
 * file loaded afterwards evaluated its module scope against Bun's navigator
 * while modules cached from the earlier load still held happy-dom's.
 *
 * One thing this cannot buy: the library's global `screen` binds `document.body`
 * when `@testing-library/dom` is evaluated, which is the `cleanup` import below
 * and therefore before any registration. **Query off the object `render()`
 * returns**, never off `screen`.
 *
 * Approach ported from toryo's `apps/board/tests/setup.ts`, which documents the
 * same traps in more detail.
 */
import {GlobalRegistrator} from '@happy-dom/global-registrator';
import {afterAll, afterEach, beforeAll} from 'bun:test';
import {cleanup} from '@testing-library/react';

declare global {
  // React reads this off the global to decide whether `act()` is supported.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/** Wire the DOM and cleanup for the calling test file. Call once at its top level. */
export function autoCleanup(): void {
  let registeredHere = false;

  beforeAll(function () {
    // Guarded rather than assumed: a second `register()` throws, and more than
    // one suite in a run may want a DOM.
    if (!GlobalRegistrator.isRegistered) {
      GlobalRegistrator.register();
      registeredHere = true;
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(cleanup);

  afterAll(async function () {
    await drainReactScheduler();
    if (registeredHere && GlobalRegistrator.isRegistered) {
      await GlobalRegistrator.unregister();
      registeredHere = false;
    }
  });
}

/**
 * Let work queued by React's cleanup cross both scheduling boundaries before
 * its captured `window` is removed. React may use an immediate or a timer
 * depending on which scheduler path the render reached.
 */
export async function drainReactScheduler(): Promise<void> {
  for (const _turn of [0, 1]) {
    await new Promise<void>(function (resolve) {
      setImmediate(resolve);
    });
    await new Promise<void>(function (resolve) {
      setTimeout(resolve, 0);
    });
  }
}
