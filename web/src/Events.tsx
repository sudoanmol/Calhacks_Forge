import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { byIdDesc, clock, payloadObj, short } from './format';

const SHOWN = 150;

function summary(payload: string): string {
  return Object.entries(payloadObj(payload))
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .slice(0, 5)
    .map(([k, v]) => `${k}=${short(typeof v === 'string' ? v : JSON.stringify(v), 48, 8)}`)
    .join('  ');
}

export function EventsPanel() {
  const [events, ready] = useTable(tables.event);
  const [open, setOpen] = useState<bigint | null>(null);
  const recent = useMemo(() => [...events].sort(byIdDesc).slice(0, SHOWN), [events]);
  return (
    <section className="panel events">
      <h2>Events <span className="muted">{ready ? `${events.length} total` : 'loading'}</span></h2>
      <ol data-testid="events">
        {recent.map((e) => (
          <li key={String(e.id)} className={open === e.id ? 'open' : ''} onClick={() => setOpen(open === e.id ? null : e.id)}>
            <div className="line">
              <span className="t">{clock(e.at)}</span>
              <span className="actor">{e.actor}</span>
              <b className="kind">{e.kind}</b>
              <span className="ref">{e.refType}{e.refId ? ` #${e.refId}` : ''}</span>
            </div>
            <div className="sum">{summary(e.payload)}</div>
            {open === e.id && <pre>{JSON.stringify(payloadObj(e.payload), null, 2)}</pre>}
          </li>
        ))}
      </ol>
    </section>
  );
}
