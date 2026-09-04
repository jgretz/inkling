/**
 * Typechecks every workspace that has its own tsconfig, plus the root project.
 *
 * A per-workspace run rather than one root project: the desk app compiles
 * against DOM and React under its own compiler options, and folding it into the
 * root project would mean one set of options has to serve both.
 *
 * Run: `bun run typecheck`
 */

import {Glob} from 'bun';

const root = new URL('..', import.meta.url).pathname;

async function projects(): Promise<string[]> {
  const glob = new Glob('{apps,packages}/*/tsconfig.json');
  const found: string[] = [];
  for await (const path of glob.scan({cwd: root})) found.push(path.replace('/tsconfig.json', ''));
  return ['.', ...found.sort()];
}

let failed = false;

for (const project of await projects()) {
  const result = await Bun.$`bunx tsc --noEmit -p ${project}`.cwd(root).nothrow();
  const ok = result.exitCode === 0;
  if (!ok) failed = true;
  process.stdout.write(`${ok ? '✓' : '✗'} ${project}\n`);
  if (!ok) process.stdout.write(result.stdout.toString() + result.stderr.toString());
}

process.exit(failed ? 1 : 0);
