// Seeds the Tier 0 catalog: one Apify Task of forge-extract per API (created or updated in place)
// and one api row per API through create_api as the founder (skipped when the row exists).
// Usage: pnpm --filter @forge/canary seed
import { Apify, Stdb, founderToken, sqlString } from './clients.ts';
import { CATALOG, apiSpec, taskInput } from './catalog.ts';

type ApifyTask = { id: string; name: string; actId: string };

const apify = new Apify();
const stdb = new Stdb();
const founder = founderToken();

const actor = (await apify.req<{ data: { id: string } }>(`/acts/${apify.username}~forge-extract`)).data;
const existingTasks = (await apify.req<{ data: { items: ApifyTask[] } }>('/actor-tasks?limit=1000')).data.items;

const report = [];
for (const a of CATALOG) {
  const input = taskInput(a);
  const found = existingTasks.find((t) => t.name === a.name && t.actId === actor.id);
  const task = found
    ? (await apify.req<{ data: ApifyTask }>(`/actor-tasks/${found.id}`, { method: 'PUT', body: JSON.stringify({ input }) })).data
    : (await apify.req<{ data: ApifyTask }>('/actor-tasks', {
        method: 'POST',
        body: JSON.stringify({ actId: actor.id, name: a.name, input, options: { timeoutSecs: 300, memoryMbytes: 1024 } }),
      })).data;

  const [row] = await stdb.sql(founder, `SELECT * FROM api WHERE name = ${sqlString(a.name)}`);
  let apiAction = 'exists';
  let registeredApifyId = '';
  if (!row) {
    await stdb.call(founder, 'create_api', [JSON.stringify(apiSpec(a)), task.id, 'task']);
    apiAction = 'created';
  }
  const [api] = await stdb.sql(founder, `SELECT * FROM api WHERE name = ${sqlString(a.name)}`);
  if (api?.current_version_id !== undefined) {
    const [v] = await stdb.sql(founder, `SELECT * FROM api_version WHERE id = ${api.current_version_id}`);
    registeredApifyId = String(v?.apify_id ?? '');
  }
  report.push({
    api: a.name,
    task: { id: task.id, action: found ? 'updated' : 'created' },
    apiRow: { id: api?.id, action: apiAction, tier: api?.tier, currentVersionApifyId: registeredApifyId },
    warning: registeredApifyId && registeredApifyId !== task.id ? `api row points at ${registeredApifyId}, not task ${task.id}` : undefined,
  });
}
console.log(JSON.stringify(report, null, 2));
if (report.some((r) => r.warning)) process.exitCode = 1;
