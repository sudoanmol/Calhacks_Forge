import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { File, FileDiff, MultiFileDiff } from '@pierre/diffs/react';
import { parsePatchFiles, type FileDiffMetadata } from '@pierre/diffs';
import { Avatar } from './Avatar';
import { short } from './format';
import {
  badgeOf, consoleLines, consoleStats, relPath, replaySchedule, splitCut,
  type Badge, type ConsoleEvent, type ConsoleLine, type ToolLine,
} from './consoleLines';

const SPEEDS = [1, 4, 16] as const;
type Speed = (typeof SPEEDS)[number];

const CODE_OPTIONS = { theme: 'pierre-dark', themeType: 'dark', overflow: 'wrap' } as const;
const DIFF_OPTIONS = { ...CODE_OPTIONS, diffStyle: 'unified' } as const;

const clockUs = (us: bigint) => new Date(Number(us / 1000n)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const secs = (us: bigint) => {
  const s = Number(us / 1_000_000n);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
};

type Props = {
  events: readonly ConsoleEvent[];
  live: boolean;
  onReplayChange?: (replaying: boolean) => void;
};

// Droid's work for one attempt, line by line: reasoning, each tool call with its policy outcome, the code it wrote, test output.
// LIVE jobs grow as subscription rows arrive. Finished jobs can replay their stored events on their real time gaps.
export function DroidConsole({ events, live, onReplayChange }: Props) {
  const lines = useMemo(() => consoleLines(events), [events]);
  const stats = useMemo(() => consoleStats(lines), [lines]);
  const schedule = useMemo(() => replaySchedule(lines), [lines]);
  const [speed, setSpeed] = useState<Speed>(4);
  const [replay, setReplay] = useState<{ startMs: number; speed: Speed } | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const logRef = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  const elapsedUs = replay ? BigInt(Math.max(0, Math.round((nowMs - replay.startMs) * 1000 * replay.speed))) : 0n;
  const shown = replay ? schedule.filter((b) => b.offsetUs <= elapsedUs).length : lines.length;
  const done = replay !== null && shown >= lines.length;

  useEffect(() => {
    if (!replay || done) return;
    let raf = 0;
    const tick = () => { setNowMs(performance.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [replay, done]);

  useEffect(() => { onReplayChange?.(replay !== null && !done); }, [replay, done, onReplayChange]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && pinned.current && (live || replay)) el.scrollTop = el.scrollHeight;
  }, [shown, live, replay]);

  const start = (s: Speed) => {
    pinned.current = true;
    const t = performance.now();
    setNowMs(t);
    setReplay({ startMs: t, speed: s });
    if (logRef.current) logRef.current.scrollTop = 0;
  };

  const session = lines.find((l) => l.type === 'session');
  const first = lines[0]?.at;
  const last = lines[shown - 1]?.at;
  const mode = live ? <span className="badge live" data-testid="dc-mode">LIVE</span>
    : replay && !done ? <span className="badge replay" data-testid="dc-mode">REPLAY {replay.speed}×</span>
      : <span className="badge recorded" data-testid="dc-mode">RECORDED</span>;

  if (!lines.length) return null;
  return <section className="dc" data-testid="droid-console" aria-label="Droid console">
    <header className="dc-head">
      <Avatar actor="droid" />
      <b>Droid console</b>
      {mode}
      {session?.type === 'session' && <span className="dc-meta">
        {session.mode === 'new' ? 'new session' : 'same session, resumed'} <code title={session.sessionId}>{short(session.sessionId, 8, 4)}</code>
      </span>}
      {first !== undefined && last !== undefined && <span className="dc-meta">{secs(last - first)}{!replay && ' of work'}</span>}
      <span className="dc-stats" data-testid="dc-stats">
        <span>{stats.files} file{stats.files === 1 ? '' : 's'} written</span>
        <span>{stats.commands} command{stats.commands === 1 ? '' : 's'} run</span>
        <span className={stats.denied ? 'dc-bad' : ''}>{stats.denied} denied</span>
        {stats.failedCalls > 0 && <span>{stats.failedCalls} failed call{stats.failedCalls === 1 ? '' : 's'}</span>}
      </span>
      {!live && <span className="dc-controls">
        {replay && !done
          ? <button type="button" onClick={() => setReplay(null)} data-testid="dc-stop">Show all</button>
          : <button type="button" onClick={() => start(speed)} data-testid="dc-play">▶ Replay</button>}
        <span className="dc-speeds" role="group" aria-label="Replay speed">
          {SPEEDS.map((s) => <button type="button" key={s} aria-pressed={speed === s} onClick={() => { setSpeed(s); if (replay && !done) start(s); }}>{s}×</button>)}
        </span>
      </span>}
    </header>
    {replay && <p className="dc-note muted">Replaying stored events at {replay.speed}× with their original timestamps. Waits over 10 s play as 1.5 s and are marked. Nothing is re-run.</p>}
    <ol className="dc-log" ref={logRef} data-testid="dc-log"
      onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {lines.slice(0, shown).map((l, i) => <li key={l.key} className={`dc-line dc-l-${l.type}`} data-line={l.type}>
        {replay && schedule[i].skippedUs > 0n && <div className="dc-skip">⏩ {secs(schedule[i].skippedUs)} wait shortened</div>}
        <span className="dc-time">{clockUs(l.at)}</span>
        <div className="dc-body"><Line l={l} /></div>
      </li>)}
      {live && <li className="dc-line dc-cursor" aria-hidden="true"><span className="dc-time" /><div className="dc-body"><span className="dc-blink">▍</span></div></li>}
    </ol>
  </section>;
}

const BADGE_TEXT: Record<Badge, string> = {
  allowed: '✓ auto-allowed', 'read-only': '○ read-only', denied: '✕ denied', approved: '★ founder-approved', waiting: '! needs approval', failed: '✕ call failed', none: '·',
};

function Line({ l }: { l: ConsoleLine }) {
  switch (l.type) {
    case 'session':
      return <div className="dc-session">
        <b>{l.mode === 'new' ? 'New Droid session' : 'Same Droid session, resumed'}</b>
        {l.keptTools.length > 0 && <span className="muted"> · tools: {l.keptTools.join(', ')}{l.disabledCount !== undefined && ` · ${l.disabledCount} disabled`}</span>}
      </div>;
    case 'worker': return <span className="dc-worker">worker › {l.text}</span>;
    case 'prompt': return <details className="dc-prompt"><summary>Ticket prompt sent to Droid</summary><pre>{l.text}</pre></details>;
    case 'think': return <Think text={l.text} />;
    case 'tool': return <Tool l={l} />;
    case 'test': {
      const ok = l.status === 'pass';
      const bad = l.status === 'fail';
      return <details className={`dc-test ${ok ? 't-ok' : bad ? 't-bad' : ''}`} data-testid={`dc-test-${l.test}`}>
        <summary><span className="dc-test-name">{l.test} test</span> {ok ? '✓ passed' : bad ? '✕ failed' : l.status}
          {l.pass !== undefined && ` · ${l.pass}/${l.pass + (l.fail ?? 0)}`}{l.ms !== undefined && ` · ${l.ms < 1000 ? `${l.ms} ms` : `${(l.ms / 1000).toFixed(1)} s`}`}</summary>
        <pre>{l.output}</pre>
      </details>;
    }
    case 'turn_done': return <span className="dc-worker">Droid ended its turn{l.durationMs !== undefined && ` after ${(l.durationMs / 1000).toFixed(1)} s`}</span>;
    case 'finished': return <span className={`dc-worker ${l.passed === false ? 'dc-bad' : l.passed ? 'dc-ok' : ''}`}>worker › all tests {l.passed === false ? 'did not pass' : l.passed ? 'passed' : 'finished'}; submitted to the Auditor</span>;
    case 'error': return <span className="dc-bad">✕ {l.text}</span>;
  }
}

function Think({ text }: { text: string }) {
  const long = text.length > 700;
  const [open, setOpen] = useState(false);
  return <div className="dc-think">
    <span className="dc-who">Droid</span>
    <p className={long && !open ? 'clamp' : ''}>{text}</p>
    {long && <button type="button" className="linkish" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show all'}</button>}
  </div>;
}

function Tool({ l }: { l: ToolLine }) {
  const badge = badgeOf(l);
  const head = <div className="dc-tool-head">
    <span className={`dc-badge b-${badge}`} title={l.decision?.reason || l.decision?.outcome}>{BADGE_TEXT[badge]}</span>
    <span className="dc-tool-name">{l.name}</span>
    <code className="dc-target">{l.target}</code>
    {l.decision?.reason && badge !== 'read-only' && <span className="dc-reason muted">{l.decision.reason}</span>}
  </div>;
  let body: ReactNode = null;
  if (l.name === 'Create' && typeof l.input.content === 'string') {
    const { text, more } = splitCut(l.input.content);
    body = <CodeBlock name={l.target} contents={text} more={more} />;
  } else if (l.name === 'Edit' && typeof l.input.old_str === 'string' && typeof l.input.new_str === 'string') {
    body = <EditBlock name={l.target} before={l.input.old_str} after={l.input.new_str} />;
  } else if (l.name === 'run_command' || l.name === 'Execute') {
    const out = (l.result?.content ?? '').replace(/^exit -?\d+\n?/, '');
    const failed = l.result?.isError || (l.exitCode !== undefined && l.exitCode !== 0);
    body = <div className={`dc-term ${failed ? 'dc-term-bad' : l.result ? 'dc-term-ok' : ''}`}>
      <div className="dc-cmd">$ {l.target}{l.exitCode !== undefined && <span className="dc-exit">exit {l.exitCode}</span>}</div>
      {out && <pre>{out}</pre>}
    </div>;
  } else if (l.name === 'TodoWrite' && typeof l.input.todos === 'string') {
    body = <pre className="dc-plan">{l.input.todos}</pre>;
  } else if (l.result?.isError) {
    body = <pre className="dc-term dc-term-bad">{l.result.content}</pre>;
  }
  return <div className={`dc-tool t-${l.name}`} data-badge={badge}>{head}{body}</div>;
}

function CodeBlock({ name, contents, more }: { name: string; contents: string; more: number }) {
  const file = useMemo(() => ({ name, contents }), [name, contents]);
  return <div className="dc-code">
    <File file={file} options={CODE_OPTIONS} />
    {more > 0 && <p className="dc-note muted">The log keeps the first {contents.length.toLocaleString()} characters; {more.toLocaleString()} more are in the final diff.</p>}
  </div>;
}

function EditBlock({ name, before, after }: { name: string; before: string; after: string }) {
  const oldFile = useMemo(() => ({ name, contents: splitCut(before).text }), [name, before]);
  const newFile = useMemo(() => ({ name, contents: splitCut(after).text }), [name, after]);
  return <div className="dc-code"><MultiFileDiff oldFile={oldFile} newFile={newFile} options={DIFF_OPTIONS} /></div>;
}

// The worker's final unified diff of the Actor (baseline → compiled), one FileDiff per file.
export function PatchView({ patch }: { patch: string }) {
  const files = useMemo((): FileDiffMetadata[] | null => {
    try {
      return parsePatchFiles(patch).flatMap((p) => p.files)
        // baseline/ → actors/<api>/ reads as a rename; show it as a change to the same file.
        .map((f) => ({ ...f, name: relPath(f.name), prevName: undefined, type: f.type.startsWith('rename') ? 'change' as const : f.type }));
    } catch { return null; }
  }, [patch]);
  if (!files?.length) return <pre>{patch}</pre>;
  return <div className="dc-diff" data-testid="dc-diff">{files.map((f) => <FileDiff key={f.name} fileDiff={f} options={DIFF_OPTIONS} />)}</div>;
}
