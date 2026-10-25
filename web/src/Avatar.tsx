import type { ActorKey } from './feedText';

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

export function Avatar({ actor }: { actor: ActorKey }) {
  const m = ROLE_META[actor];
  if (actor === 'system') return <span className="avatar none" aria-hidden="true" />;
  return (
    <span className="avatar" style={{ borderColor: m.color, color: m.color }} title={m.label} aria-hidden="true">
      {m.initials}
    </span>
  );
}
