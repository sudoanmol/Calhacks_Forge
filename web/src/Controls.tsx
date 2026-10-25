import { useEffect, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from './module_bindings';
import type { Config } from './module_bindings/types';
import { usd } from './format';

export function ApprovalCards({ founder }: { founder: boolean }) {
  const [approvals] = useTable(tables.approval);
  const decide = useReducer(reducers.decideApproval);
  const [busy, setBusy] = useState<bigint>();
  const [message, setMessage] = useState('');
  const pending = approvals.filter((a) => a.status === 'pending');
  async function act(id: bigint, approve: boolean) {
    setBusy(id); setMessage('');
    try { await decide({ id, approve }); setMessage(`Approval #${id} ${approve ? 'approved' : 'rejected'}.`); }
    catch (err) { setMessage(String(err)); }
    finally { setBusy(undefined); }
  }
  return <section className="approval-cards" aria-label="Founder approvals">
    {pending.map((a) => <article className="approval-card" key={String(a.id)}>
      <h3>{a.kind.replaceAll('_', ' ')} · #{String(a.id)}</h3>
      <p>{a.refType} #{String(a.refId)} · {usd(a.amountCents)} <span className="badge test">TEST MODE</span></p>
      <pre>{a.detail}</pre>
      <button disabled={!founder || busy !== undefined} onClick={() => act(a.id, true)}>Approve</button>{' '}
      <button disabled={!founder || busy !== undefined} onClick={() => act(a.id, false)}>Reject</button>
      {!founder && <p className="muted">Founder identity required.</p>}
    </article>)}
    {message && <p role="status">{message}</p>}
  </section>;
}

function ConfigEditor({ row, founder }: { row: Config; founder: boolean }) {
  const setConfig = useReducer(reducers.setConfig);
  const [value, setValue] = useState(row.value);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setValue(row.value), [row.value]);
  return <form className="control-row" onSubmit={async (e) => {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await setConfig({ key: row.key, value }); setMessage('Saved.'); }
    catch (err) { setMessage(String(err)); }
    finally { setBusy(false); }
  }}>
    <label htmlFor={`config-${row.key}`}>{row.key}</label>
    <input id={`config-${row.key}`} value={value} onChange={(e) => setValue(e.target.value)} disabled={!founder || busy} />
    <button disabled={!founder || busy || value === row.value}>Save</button>
    {message && <p role="status">{message}</p>}
  </form>;
}

export function ControlsTab({ founder }: { founder: boolean }) {
  const [budgets] = useTable(tables.budget);
  const [config] = useTable(tables.config);
  const setBudget = useReducer(reducers.setBudgetCap);
  const budget = budgets.find((b) => b.name === 'engineering');
  const [cap, setCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { if (budget) setCap(String(budget.capCents)); }, [budget?.capCents]);
  return <section>
    <h2>Founder controls <span className="badge test">TEST MODE</span></h2>
    {!founder && <p role="status">Read-only. Connect with the founder identity to make changes.</p>}
    <form className="control-row" onSubmit={async (e) => {
      e.preventDefault(); const amount = Number(cap);
      if (!Number.isInteger(amount) || amount < 0 || amount > 0xffff_ffff) { setMessage('Enter a whole number of cents between 0 and 4294967295.'); return; }
      setBusy(true); setMessage('');
      try { await setBudget({ capCents: amount }); setMessage('Budget saved. Queued compiles have been re-evaluated.'); }
      catch (err) { setMessage(String(err)); }
      finally { setBusy(false); }
    }}>
      <label htmlFor="engineering-cap">Engineering budget cap, cents</label>
      <input id="engineering-cap" type="number" min="0" max="4294967295" step="1" required value={cap} onChange={(e) => setCap(e.target.value)} disabled={!founder || busy} />
      <button disabled={!founder || busy || !budget || cap === String(budget.capCents)}>Save budget</button>
    </form>
    {budget && <p>Reserved {usd(budget.reservedCents)} · spent {usd(budget.spentCents)} · cap {usd(budget.capCents)} <span className="badge test">TEST MODE</span></p>}
    {message && <p role="status">{message}</p>}
    <h3>Company rules</h3>
    {[...config].sort((a, b) => a.key.localeCompare(b.key)).map((row) => <ConfigEditor key={row.key} row={row} founder={founder} />)}
  </section>;
}
