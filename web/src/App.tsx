import { useMemo } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';

const time = (ts: { microsSinceUnixEpoch: bigint }) =>
  new Date(Number(ts.microsSinceUnixEpoch / 1000n)).toLocaleTimeString();

export function App({ db }: { db: string }) {
  const conn = useSpacetimeDB();
  const [events, eventsReady] = useTable(tables.event);
  const [tasks] = useTable(tables.task);
  const [staff] = useTable(tables.staff);
  const [config] = useTable(tables.config);

  const recent = useMemo(() => [...events].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 50), [events]);
  const openTasks = tasks.filter((t) => t.status === 'queued' || t.status === 'claimed').length;

  return (
    <div className="app">
      <header className="stats" data-testid="stats">
        <span className="badge test">TEST MODE</span>
        <span className="badge live">LIVE</span>
        <span>db <b>{db}</b></span>
        <span data-testid="conn">{conn.isActive ? 'connected' : conn.connectionError ? `error: ${conn.connectionError.message}` : 'connecting…'}</span>
        <span>staff <b>{staff.length}</b></span>
        <span>open tasks <b data-testid="open-tasks">{openTasks}</b></span>
        <span>config keys <b>{config.length}</b></span>
        <span className="identity" title={conn.identity?.toHexString()}>{conn.identity ? `you: ${conn.identity.toHexString().slice(0, 10)}…` : ''}</span>
      </header>
      <main>
        <section className="panel">
          <h2>Tasks</h2>
          <table>
            <thead><tr><th>id</th><th>kind</th><th>role</th><th>status</th><th>attempt</th></tr></thead>
            <tbody>
              {[...tasks].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 30).map((t) => (
                <tr key={String(t.id)}><td>{String(t.id)}</td><td>{t.kind}</td><td>{t.role}</td><td>{t.status}</td><td>{t.attempt}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel events">
          <h2>Events {eventsReady ? `(${events.length})` : '(loading)'}</h2>
          <ol data-testid="events">
            {recent.map((e) => (
              <li key={String(e.id)}>
                <span className="t">{time(e.at)}</span> <b>{e.kind}</b> <span className="actor">{e.actor}</span>
                <code>{e.payload.slice(0, 140)}</code>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
