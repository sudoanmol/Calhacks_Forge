// Usage: pnpm --filter @forge/droid-runner compile <apiName> [--no-copy-back]
// One-shot local compile outside the task queue (no reducers are called): one Droid turn plus one
// in-session repair if the tests fail. The queued flow is runner.ts.
import { runCompile, type CompileSummary } from './compiler.ts';
import { REPO, readSecrets } from './env.ts';

const args = process.argv.slice(2);
const apiName = args.find((a) => !a.startsWith('--'));
if (!apiName || !/^[a-z0-9][a-z0-9-]*$/.test(apiName)) throw new Error('usage: compile <apiName> (lowercase letters, digits, dashes)');

const s: CompileSummary = await runCompile({
  repo: REPO, apiName, secrets: readSecrets(), repairTurns: 1, copyBack: !args.includes('--no-copy-back'),
});
const { diff, tests, ...rest } = s;
console.log(JSON.stringify({
  ...rest,
  tests: Object.fromEntries(Object.values(tests).map((r) => [r.kind, { status: r.status, pass: r.pass, fail: r.fail, skipped: r.skipped, live: r.live }])),
}, null, 2));
if (!s.passed) process.exitCode = 1;
