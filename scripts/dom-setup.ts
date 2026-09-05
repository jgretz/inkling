/**
 * Gives `bun test` a DOM, so component tests can render.
 *
 * Named in two places on purpose: the root `test` script, where it stays visible
 * beside the command that uses it, and `bunfig.toml`, which is what a bare
 * `bun test` reads. Only the script would leave the bare command failing every
 * render suite, and the bare command is the one documented in `CLAUDE.md`. bun's
 * module cache evaluates this file once, so registering twice is not a risk.
 *
 * Suites with no DOM in them are unaffected: registering happy-dom's globals
 * costs nothing they touch.
 */

import {GlobalRegistrator} from '@happy-dom/global-registrator';

GlobalRegistrator.register();
