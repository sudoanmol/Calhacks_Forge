import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { clock } from './format';
import { Avatar } from './Avatar';
import { ACTIVE_STATUSES, compileStatusSentence, MONEY_STATUSES } from './engText';

// One row pinned at the bottom of the rail: the newest live-API compile job in one sentence.
export function DroidStrip({ onOpen }: { onOpen: (ticketId: bigint) => void }) {
  const [jobs] = useTable(tables.compileJob);
  const [apis] = useTable(tables.api);
  const [retired] = useTable(tables.apiRetired);
  const [versions] = useTable(tables.apiVersion);
  const [budgets] = useTable(tables.budget);
  const [events] = useTable(tables.event);
  const gone = new Set(retired.map((r) => r.apiId));
  const live = jobs.filter((j) => !gone.has(j.apiId)).sort((a, b) => (a.ticketId > b.ticketId ? -1 : 1));
  const job = live[0];
  let sentence = 'No engineering work yet';
  if (job) {
    const name = apis.find((a) => a.id === job.apiId)?.name ?? `API ${job.apiId}`;
    const version = job.versionId !== undefined ? versions.find((v) => v.id === job.versionId)?.version : undefined;
    const status = compileStatusSentence(job, { budget: budgets.find((b) => b.name === 'engineering'), events, version });
    const busy = live.filter((j) => ACTIVE_STATUSES.has(j.status)).length;
    const rest = busy ? `${busy} other job${busy === 1 ? '' : 's'} open` : 'nothing queued';
    sentence = ACTIVE_STATUSES.has(job.status)
      ? `${name}: ${status}${MONEY_STATUSES.has(job.status) ? ' · TEST MODE' : ''}`
      : job.status === 'shipped'
        ? `Idle · ${name} v${version ?? '?'} shipped ${clock(job.updatedAt)} · ${rest}`
        : `Idle · ${name}: ${status} · ${rest}`;
  }
  return (
    <section className="panel droid-strip" data-testid="droid-strip" aria-label="Droid engineering status">
      <Avatar actor="droid" />
      <span className="picker-title">Droid</span>
      <span className="droid-strip-text" title={sentence}>{sentence}</span>
      {job && <button className="linkish" onClick={() => onOpen(job.ticketId)} data-testid="droid-strip-open">Open →</button>}
    </section>
  );
}
