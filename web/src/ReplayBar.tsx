import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Timestamp } from 'spacetimedb';
import { useTable } from './db';
import { tables } from './module_bindings';
import type { Orders as Order } from './module_bindings/types';
import { clock, micros } from './format';
import { durationText } from './scene';
import { LIVE_STATE, SPEEDS, orderTimeline, type ReplayState, type Speed } from './replay';

const TICK_MS = 100;

export type Replay = {
  state: ReplayState;
  start?: bigint;
  end?: bigint;
  play: () => void;
  pause: () => void;
  seek: (cursor: bigint) => void;
  setSpeed: (s: Speed) => void;
  live: () => void;
};

// One replay per selected order. The cursor only hides rows newer than it; nothing is fetched or called.
export function useReplay(order: Order | undefined): Replay {
  const [events] = useTable(tables.event);
  const [tasks] = useTable(tables.task);
  const [runs] = useTable(tables.run);
  const [apis] = useTable(tables.api);
  const [state, setState] = useState<ReplayState>(LIVE_STATE);
  const bounds = useMemo(() => {
    if (!order) return undefined;
    const tl = orderTimeline(order, events, tasks, runs, apis);
    if (!tl.length) return undefined;
    let lo = micros(tl[0].at), hi = lo;
    for (const e of tl) { const t = micros(e.at); if (t < lo) lo = t; if (t > hi) hi = t; }
    return { start: lo, end: hi };
  }, [order, events, tasks, runs, apis]);

  useEffect(() => setState((s) => ({ ...LIVE_STATE, speed: s.speed })), [order?.id]);

  const end = bounds?.end;
  useEffect(() => {
    if (!state.playing || end === undefined) return;
    const step = BigInt(state.speed * TICK_MS) * 1000n;
    const id = setInterval(() => setState((s) => {
      const next = (s.cursor ?? end) + step;
      return next >= end ? { ...s, cursor: end, playing: false } : { ...s, cursor: next };
    }), TICK_MS);
    return () => clearInterval(id);
  }, [state.playing, state.speed, end]);

  return {
    state,
    start: bounds?.start,
    end: bounds?.end,
    play: () => bounds && setState((s) => ({ ...s, playing: true, cursor: s.cursor === null || s.cursor >= bounds.end ? bounds.start : s.cursor })),
    pause: () => setState((s) => ({ ...s, playing: false })),
    seek: (cursor) => setState((s) => ({ ...s, cursor })),
    setSpeed: (speed) => setState((s) => ({ ...s, speed })),
    live: () => setState((s) => ({ ...LIVE_STATE, speed: s.speed })),
  };
}

const ts = (m: bigint) => new Timestamp(m);

export function ReplayBar({ replay }: { replay: Replay }) {
  const { state, start, end } = replay;
  if (start === undefined || end === undefined) return null;
  const inReplay = state.cursor !== null;
  const cursor = state.cursor ?? end;
  const maxS = Math.max(1, Math.ceil(Number(end - start) / 1e6));
  const valueS = Math.min(maxS, Math.floor(Number(cursor - start) / 1e6));
  if (!inReplay) {
    return (
      <div className="replay-bar compact" role="toolbar" aria-label="Replay" data-testid="replay-bar">
        <button className="replay-play" onClick={replay.play} data-testid="replay-play">▶ Replay this order</button>
        <span className="muted">recorded run, {durationText(ts(start), ts(end)) || '0 s'}</span>
      </div>
    );
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // Buttons already activate on space; everywhere else in the bar space toggles play.
    if (e.key !== ' ' || (e.target as HTMLElement).tagName === 'BUTTON') return;
    e.preventDefault();
    if (state.playing) replay.pause(); else replay.play();
  };
  return (
    <div className={`replay-bar ${inReplay ? 'on' : ''}`} role="toolbar" aria-label="Replay" onKeyDown={onKey} data-testid="replay-bar">
      {inReplay ? <span className="badge replay" data-testid="replay-badge">REPLAY</span> : <span className="replay-label">Replay</span>}
      <span className="replay-range muted">recorded {clock(ts(start))} → {clock(ts(end))} ({durationText(ts(start), ts(end)) || '0 s'})</span>
      <button
        className="replay-play" onClick={() => (state.playing ? replay.pause() : replay.play())}
        aria-label={state.playing ? 'Pause' : 'Play'} data-testid="replay-play"
      >{state.playing ? '❚❚' : '▶'}</button>
      <span className="seg replay-speeds" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} className={s === state.speed ? 'on' : ''} aria-pressed={s === state.speed} onClick={() => replay.setSpeed(s)} data-testid={`replay-speed-${s}`}>{s}×</button>
        ))}
      </span>
      <input
        className="replay-scrub" type="range" min={0} max={maxS} step={1} value={valueS}
        aria-label="Replay time" aria-valuetext={clock(ts(cursor))} data-testid="replay-scrub"
        onChange={(e) => {
          const v = Number(e.target.value);
          replay.pause();
          replay.seek(v >= maxS ? end : start + BigInt(v) * 1_000_000n);
        }}
      />
      <span className="replay-clock" data-testid="replay-clock">{clock(ts(cursor))}</span>
      {inReplay && <button className="replay-live" onClick={replay.live} data-testid="replay-live">Back to live</button>}
    </div>
  );
}
