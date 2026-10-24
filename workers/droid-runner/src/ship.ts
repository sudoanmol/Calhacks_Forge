// Ships an audited, founder-approved compile: `apify push` of actors/<api>, then confirms the build
// through the Apify API. Runs only from runner.ts on a `ship` task, never inside a Droid session.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { srcHash } from './compiler.ts';
import type { DroidEvent } from './events.ts';

export type ShipResult = {
  actorId: string; actorName: string; version: string; fields: string[];
  buildId: string; buildNumber: string; buildStatus: string; pushMs: number; pushOutput: string;
};

type ShipOptions = {
  repo: string; apiName: string; secrets: Record<string, string>; expectedSrcHash: string;
  emit?: (evt: DroidEvent) => void;
};

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ code: number | null; output: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const add = (b: Buffer) => { output = (output + b.toString()).slice(-200_000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolveRun({ code, output }); });
  });
}

async function apify<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`https://api.apify.com/v2${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.text();
  if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${body.slice(0, 300)}`);
  return (JSON.parse(body) as { data: T }).data;
}

export async function shipActor(o: ShipOptions): Promise<ShipResult> {
  const dir = join(o.repo, 'actors', o.apiName);
  if (!existsSync(join(dir, '.actor/actor.json'))) throw new Error(`no Actor at ${dir}`);
  const hash = srcHash(dir);
  if (hash !== o.expectedSrcHash) throw new Error(`actors/${o.apiName}/src changed since the Auditor accepted it (${hash} != ${o.expectedSrcHash})`);
  const actor = JSON.parse(readFileSync(join(dir, '.actor/actor.json'), 'utf8')) as { name: string; version: string };
  if (!/^\d+\.\d+$/.test(actor.version)) throw new Error(`.actor/actor.json version ${actor.version} must look like 1.0`);
  const spec = JSON.parse(readFileSync(join(dir, 'api.json'), 'utf8')) as { outputSchema?: { properties?: Record<string, unknown> } };
  const fields = Object.keys(spec.outputSchema?.properties ?? {});
  if (!fields.length) throw new Error('api.json has no output fields');
  const token = o.secrets.APIFY_TOKEN;
  const username = o.secrets.APIFY_USERNAME;
  if (!token || !username) throw new Error('APIFY_TOKEN and APIFY_USERNAME must be set in .env');

  o.emit?.({ kind: 'ship_push_started', actor: actor.name, version: actor.version, dir: `actors/${o.apiName}` });
  const t0 = Date.now();
  // HOME carries the Apify CLI login and its local secrets file (the Actor's @brightdataApiKey).
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, APIFY_TOKEN: token } as NodeJS.ProcessEnv;
  const push = await run('pnpm', ['exec', 'apify', 'push', '--json', '--dir', dir, '--wait-for-finish', '900'], o.repo, env, 20 * 60_000);
  const pushMs = Date.now() - t0;
  const pushOutput = push.output.slice(-4000);
  o.emit?.({ kind: 'ship_push_finished', exitCode: push.code, ms: pushMs, output: pushOutput });
  if (push.code !== 0) throw new Error(`apify push exited ${push.code}: ${pushOutput.slice(-1500)}`);

  const act = await apify<{ id: string; name: string }>(token, `/acts/${username}~${actor.name}`);
  const builds = await apify<{ items: Array<{ id: string; status: string; buildNumber: string }> }>(token, `/acts/${act.id}/builds?desc=1&limit=1`);
  const build = builds.items[0];
  if (!build) throw new Error(`${actor.name} has no build`);
  if (build.status !== 'SUCCEEDED') throw new Error(`latest build ${build.id} of ${actor.name} is ${build.status}`);
  if (!build.buildNumber.startsWith(`${actor.version}.`)) throw new Error(`latest build ${build.buildNumber} is not version ${actor.version}`);
  return { actorId: act.id, actorName: actor.name, version: actor.version, fields, buildId: build.id, buildNumber: build.buildNumber, buildStatus: build.status, pushMs, pushOutput };
}
