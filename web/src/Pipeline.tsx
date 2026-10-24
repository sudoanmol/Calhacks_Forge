import { FLOW, SIDE, STATION_META, durationText, type Scene, type StationId } from './scene';
import { SPONSOR_COLOR, STATE_COLOR } from './Floor';

const MARK: Record<string, string> = { done: '✓', rejected: '✕', failed: '✕', waiting: '!', working: '●', idle: '', skipped: '–' };

export function Pipeline({ scene, onOpen }: { scene: Scene; onOpen: (id: StationId) => void }) {
  const row = (id: StationId) => {
    const v = scene.stations[id];
    const m = STATION_META[id];
    const dur = v.state === 'working' ? '' : durationText(v.start, v.end);
    return (
      <li key={id} className={`pl st-${v.state}`} style={{ ['--c' as string]: STATE_COLOR[v.state] }} data-testid={`pl-${id}`}>
        <button onClick={() => onOpen(id)}>
          <span className="pl-mark">{MARK[v.state]}</span>
          <span className="pl-body">
            <span className="pl-head"><b>{m.name}</b><span className="pl-sponsor" style={{ color: SPONSOR_COLOR[m.sponsor] }}>{m.sponsor}</span>{dur && <span className="muted">{dur}</span>}</span>
            <span className="pl-cap">{v.caption || v.state}</span>
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="pipeline" data-testid="pipeline">
      <ol>{FLOW.map(row)}</ol>
      <h3 className="pl-side">Back office</h3>
      <ol>{SIDE.map(row)}</ol>
    </div>
  );
}
