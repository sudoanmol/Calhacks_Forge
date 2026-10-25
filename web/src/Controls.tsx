import { useEffect, useRef, useState, type ReactNode } from 'react';
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

export function ControlsModal({ founder, onClose }: { founder: boolean; onClose: () => void }) {
  const [budgets] = useTable(tables.budget);
  const [config] = useTable(tables.config);
  const setBudget = useReducer(reducers.setBudgetCap);
  const setConfig = useReducer(reducers.setConfig);
  const budget = budgets.find((b) => b.name === 'engineering');
  const cfg = (key: string) => config.find((c) => c.key === key)?.value;
  const closeRef = useRef<HTMLButtonElement>(null);
  // Focus moves into the dialog on open and back to whatever opened it (the gear) on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const setKey = (key: string) => (value: string) => setConfig({ key, value });
  return <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="controls-title" data-testid="controls-modal">
      <header>
        <h2 id="controls-title">Company rules · <span className="badge test">TEST MODE</span></h2>
        <button ref={closeRef} className="close" onClick={onClose} aria-label="Close">✕</button>
      </header>
      {!founder && <p role="status" className="muted">Read-only. Connect with the founder identity to make changes.</p>}
      <Lever
        id="budget-cap" label="Engineering budget cap" kind="dollars" founder={founder}
        current={budget ? String(budget.capCents) : undefined}
        effect="Lowering it makes compiles that no longer fit ineligible immediately; raising it requeues them."
        save={(cents) => setBudget({ capCents: Number(cents) })}
        note={budget && <>Reserved {usd(budget.reservedCents)} · spent {usd(budget.spentCents)} · cap {usd(budget.capCents)} <span className="badge test">TEST MODE</span></>}
      />
      <Lever id="compile_min_buyers" label="Build after N distinct buyers" kind="integer" founder={founder} current={cfg('compile_min_buyers')}
        effect="An API with this many buyers gets a compile ticket; the CFO decides whether to invest." save={setKey('compile_min_buyers')} />
      <Lever id="creao_max_concurrency" label="CREAO runs at once" kind="integer" founder={founder} current={cfg('creao_max_concurrency')}
        effect="Fewer concurrent runs means tasks queue at the stations." save={setKey('creao_max_concurrency')} />
      <Lever id="refund_limit_cents" label="Refund limit" kind="dollars" founder={founder} current={cfg('refund_limit_cents')}
        effect="Refunds above it need the founder's approval." save={setKey('refund_limit_cents')} />
      <details className="advanced">
        <summary>Advanced</summary>
        {[...config].filter((c) => !PRIMARY_KEYS.has(c.key)).sort((a, b) => a.key.localeCompare(b.key))
          .map((row) => <ConfigEditor key={row.key} row={row} founder={founder} />)}
      </details>
    </section>
  </div>;
}

const PRIMARY_KEYS = new Set(['compile_min_buyers', 'creao_max_concurrency', 'refund_limit_cents']);

const centsToDollars = (cents: string) => (Number(cents) / 100).toFixed(2);

// `current` and the value passed to `save` are in the stored unit (cents for dollar levers).
function Lever({ id, label, kind, current, effect, save, founder, note }: {
  id: string; label: string; kind: 'dollars' | 'integer'; current: string | undefined; effect: string;
  save: (stored: string) => Promise<unknown>; founder: boolean; note?: ReactNode;
}) {
  const shown = current === undefined ? '' : kind === 'dollars' ? centsToDollars(current) : current;
  const [value, setValue] = useState(shown);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setValue(shown), [shown]);
  const display = current === undefined ? 'not set' : kind === 'dollars' ? `$${centsToDollars(current)} TEST MODE` : current;
  return <form className="lever" data-testid={`lever-${id}`} onSubmit={async (e) => {
    e.preventDefault();
    const n = Number(value);
    const stored = kind === 'dollars' ? Math.round(n * 100) : n;
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(stored) || stored > 0xffff_ffff) {
      setMessage(kind === 'dollars' ? 'Enter a dollar amount of 0 or more.' : 'Enter a whole number of 0 or more.');
      return;
    }
    setBusy(true); setMessage('');
    try { await save(String(stored)); setMessage('Saved.'); }
    catch (err) { setMessage(String(err)); }
    finally { setBusy(false); }
  }}>
    <div className="lever-head">
      <label htmlFor={`lever-${id}-input`}>{label}</label>
      <b>{display}</b>
    </div>
    <p className="muted">{effect}</p>
    <div className="lever-input">
      {kind === 'dollars' && <span>$</span>}
      <input id={`lever-${id}-input`} type="number" min="0" step={kind === 'dollars' ? '0.01' : '1'} required value={value}
        onChange={(e) => setValue(e.target.value)} disabled={!founder || busy || current === undefined} />
      <button disabled={!founder || busy || value === shown}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
    {note && <p className="lever-note">{note}</p>}
    {message && <p role="status">{message}</p>}
  </form>;
}
