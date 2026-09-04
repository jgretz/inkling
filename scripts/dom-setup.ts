/**
 * Gives `bun test` a DOM, so component tests can render.
 *
 * Preloaded by the root `test` script rather than by a `bunfig.toml`, which
 * keeps it visible in `package.json` beside the command that uses it. Suites
 * with no DOM in them are unaffected: registering happy-dom's globals costs
 * nothing they touch.
 */

import {GlobalRegistrator} from '@happy-dom/global-registrator';

GlobalRegistrator.register();
