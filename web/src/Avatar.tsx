import type { ActorKey } from './feedText';
import type { StationId } from './scene';

export const ROLE_META: Record<ActorKey, { label: string; initials: string; color: string }> = {
  front_desk: { label: 'Front Desk', initials: 'FD', color: '#6d9bff' },
  coo: { label: 'COO', initials: 'COO', color: '#b896ff' },
  research: { label: 'Research', initials: 'RE', color: '#3fd0c0' },
  cfo: { label: 'CFO', initials: 'CFO', color: '#f2b33d' },
  auditor: { label: 'Auditor', initials: 'AU', color: '#ff7cc0' },
  droid: { label: 'Droid', initials: 'DR', color: '#a9b4c6' },
  treasurer: { label: 'Treasurer', initials: 'TR', color: '#e9c35a' },
  rules: { label: 'Rules', initials: 'RU', color: '#8d8780' },
  founder: { label: 'Founder', initials: 'FO', color: '#fff6e6' },
  warehouse: { label: 'Warehouse', initials: 'WH', color: '#97d74f' },
  brightdata: { label: 'Bright Data', initials: 'BD', color: '#5fb8e8' },
  canary: { label: 'Canary', initials: 'CA', color: '#7a8aa8' },
  system: { label: 'System', initials: '', color: '#6b6357' },
};

// Stations staffed by a role; the customer, warehouse, verify portal and delivery counter carry no avatar on the floor.
export const STATION_ACTOR: Partial<Record<StationId, ActorKey>> = {
  desk: 'front_desk', coo: 'coo', research: 'research', cfo: 'cfo', auditor: 'auditor', droid: 'droid', treasurer: 'treasurer',
};

// The same disc as `Avatar`, drawn inside the floor SVG.
export function AvatarSvg({ actor, x, y, r = 14 }: { actor: ActorKey; x: number; y: number; r?: number }) {
  const m = ROLE_META[actor];
  return (
    <g aria-hidden="true" data-testid={`floor-avatar-${actor}`}>
      <circle cx={x} cy={y} r={r} fill="#15130f" stroke={m.color} strokeWidth={2.5} />
      <text x={x} y={y + r * 0.3} textAnchor="middle" fill={m.color} fontSize={m.initials.length > 2 ? r * 0.62 : r * 0.78} fontWeight={800}>{m.initials}</text>
    </g>
  );
}

export function Avatar({ actor }: { actor: ActorKey }) {
  const m = ROLE_META[actor];
  if (actor === 'system') return <span className="avatar none" aria-hidden="true" />;
  return (
    <span className="avatar" style={{ borderColor: m.color, color: m.color }} title={m.label} aria-hidden="true">
      {m.initials}
    </span>
  );
}
