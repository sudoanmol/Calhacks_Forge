import type { ReactNode } from 'react';
import type { Challenge, Evidence, GateCheck, Run, ValueRecord } from './module_bindings/types';
import { byIdAsc, clock, short, usd } from './format';

// Detail tables shared by the Office station drawer.

export function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section className="dsec"><h3>{title}</h3>{children}</section>;
}

export function GateTable({ gates }: { gates: GateCheck[] }) {
  if (!gates.length) return <p className="muted">None.</p>;
  return (
    <table><thead><tr><th>check</th><th>result</th><th>citation</th><th>at</th></tr></thead>
      <tbody>{[...gates].sort(byIdAsc).map((x) => (
        <tr key={String(x.id)}>
          <td>{x.check}</td><td><span className={`badge r-${x.result}`}>{x.result}</span></td>
          <td>{x.citationUrl ? <a href={x.citationUrl} target="_blank" rel="noreferrer">{x.citationText || x.citationUrl}</a> : x.citationText}</td>
          <td className="muted">{clock(x.at)}</td>
        </tr>))}</tbody></table>
  );
}

export function statusCounts(values: ValueRecord[]) {
  return values.reduce<Record<string, number>>((m, x) => ((m[x.status] = (m[x.status] ?? 0) + 1), m), {});
}

export function CountBadges({ values }: { values: ValueRecord[] }) {
  return <>{Object.entries(statusCounts(values)).map(([k, n]) => <span key={k} className={`badge v-${k}`}>{n} {k}</span>)}</>;
}

export function ValuesTable({ values }: { values: ValueRecord[] }) {
  if (!values.length) return <p className="muted">None yet.</p>;
  const v = [...values].sort((a, b) => a.row - b.row || (a.id < b.id ? -1 : 1));
  return (
    <div className="scroll"><table className="values" data-testid="values"><thead><tr><th>row</th><th>entity</th><th>metric</th><th>value</th><th>excerpt</th><th>source</th><th>status</th></tr></thead>
      <tbody>{v.map((x) => (
        <tr key={String(x.id)}>
          <td>{x.row}</td><td>{x.entity}</td><td>{x.metric}</td><td className="val">{x.value}</td>
          <td className="excerpt">“{x.excerpt}”</td>
          <td>{x.sourceUrl ? <a href={x.sourceUrl} target="_blank" rel="noreferrer">{short(x.sourceUrl.replace(/^https?:\/\//, ''), 24, 8)}</a> : ''}</td>
          <td><span className={`badge v-${x.status}`}>{x.status}</span>{x.freshValue && <div className="muted">fresh: {x.freshValue}</div>}</td>
        </tr>))}</tbody></table></div>
  );
}

export function EvidenceTable({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return <p className="muted">None yet.</p>;
  return (
    <div className="scroll"><table><thead><tr><th>#</th><th>method</th><th>country</th><th>http</th><th>ms</th><th>url</th><th>reason</th><th>at</th></tr></thead>
      <tbody>{[...evidence].sort(byIdAsc).map((x) => (
        <tr key={String(x.id)}>
          <td>{x.attempt}</td><td>{x.method}</td><td>{x.country}</td>
          <td><span className={`badge ${x.httpStatus === 200 && !x.reason ? 'v-verified' : 'v-mismatch'}`}>{x.httpStatus || '—'}</span></td>
          <td>{x.ms}</td><td>{short(x.url.replace(/^https?:\/\//, ''), 28, 8)}</td>
          <td>{x.reason || <span className="muted">ok</span>}</td><td className="muted">{clock(x.fetchedAt)}</td>
        </tr>))}</tbody></table></div>
  );
}

export function RunsTable({ runs }: { runs: Run[] }) {
  if (!runs.length) return <p className="muted">None yet.</p>;
  return (
    <div className="scroll"><table><thead><tr><th>provider</th><th>status</th><th>link</th><th>cost</th><th>started</th><th>ended</th></tr></thead>
      <tbody>{[...runs].sort(byIdAsc).map((x) => (
        <tr key={String(x.id)}>
          <td>{x.provider}</td><td>{x.status}</td>
          <td>{x.shareUrl ? <a href={x.shareUrl} target="_blank" rel="noreferrer">{x.externalId || 'open'}</a> : <span className="muted" title={x.threadId ? `thread ${x.threadId}` : undefined}>{x.externalId ? short(x.externalId, 8, 4) : 'no link'}</span>}</td>
          <td>{usd(x.costCents)}</td><td className="muted">{clock(x.startedAt)}</td><td className="muted">{clock(x.endedAt)}</td>
        </tr>))}</tbody></table></div>
  );
}

export function ChallengesTable({ challenges }: { challenges: Challenge[] }) {
  if (!challenges.length) return <p className="muted">None.</p>;
  return (
    <div className="scroll"><table><thead><tr><th>value</th><th>reason</th><th>status</th><th>auditor</th></tr></thead>
      <tbody>{[...challenges].sort(byIdAsc).map((x) => (
        <tr key={String(x.id)}><td>#{String(x.valueRecordId)}</td><td>{x.reason}</td><td><span className={`badge c-${x.status}`}>{x.status}</span></td><td>{x.auditorReason}</td></tr>))}</tbody></table></div>
  );
}
