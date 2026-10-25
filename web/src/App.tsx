import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { OfficeTab } from './Office';
import { ApisTab } from './Apis';
import { EventsPanel } from './Events';
import { ApprovalCards, ControlsModal } from './Controls';
import { EngineeringTab } from './Engineering';
import { Header } from './Header';
import { useScope } from './scope';

const TABS = ['Office', 'Catalog', 'Engineering'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Office');
  const [controls, setControls] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const scope = useScope(showTest);
  const connection = useSpacetimeDB();
  const [staff] = useTable(tables.staff);
  const identity = connection.identity;
  const founder = connection.isActive && identity !== undefined && staff.some((s) => s.role === 'founder' && s.identity.isEqual(identity));
  return (
    <div className="app">
      <Header scope={scope} founder={founder} onControls={() => setControls(true)} />
      <main>
        <section className="panel mainpanel">
          <ApprovalCards founder={founder} />
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'on' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t}</button>
            ))}
          </nav>
          {tab === 'Office'
            ? <OfficeTab scope={scope} setShowTest={setShowTest} />
            : tab === 'Catalog' ? <ApisTab scope={scope} onEngineering={() => setTab('Engineering')} /> : <EngineeringTab founder={founder} />}
        </section>
        <EventsPanel />
      </main>
      {controls && <ControlsModal founder={founder} onClose={() => setControls(false)} />}
    </div>
  );
}
