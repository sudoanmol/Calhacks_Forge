import { useState } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables } from './module_bindings';
import { OfficeTab, useMedia, useOrderSelection } from './Office';
import { ApisTab } from './Apis';
import { ControlsModal } from './Controls';
import { EngineeringTab } from './Engineering';
import { Header } from './Header';
import { OrderHero } from './OrderHero';
import { Feed } from './Feed';
import { NeedsYou } from './NeedsYou';
import { DroidStrip } from './DroidStrip';
import { useScope } from './scope';
import type { StationId } from './scene';

const TABS = ['Office', 'Catalog', 'Engineering'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Office');
  const [controls, setControls] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [engJob, setEngJob] = useState<bigint | null>(null);
  const openEngineering = (ticketId: bigint) => { setEngJob(ticketId); setTab('Engineering'); };
  const scope = useScope(showTest);
  const sel = useOrderSelection(scope);
  const connection = useSpacetimeDB();
  const [staff] = useTable(tables.staff);
  const identity = connection.identity;
  const founder = connection.isActive && identity !== undefined && staff.some((s) => s.role === 'founder' && s.identity.isEqual(identity));
  const openStation = (id: StationId) => { setTab('Office'); sel.setDrawer(id); };
  // The phone stacks Needs you above the order headline; the desktop keeps it at the top of the rail.
  const phone = useMedia('(max-width: 800px)');
  return (
    <div className="app">
      <Header scope={scope} founder={founder} onControls={() => setControls(true)} />
      {phone && <NeedsYou scope={scope} founder={founder} />}
      {tab === 'Office' && sel.selected && <OrderHero order={sel.selected} scope={scope} />}
      <main>
        <section className="panel mainpanel">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'on' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t}</button>
            ))}
          </nav>
          {tab === 'Office'
            ? <OfficeTab scope={scope} setShowTest={setShowTest} sel={sel} />
            : tab === 'Catalog' ? <ApisTab scope={scope} onEngineering={() => setTab('Engineering')} /> : <EngineeringTab founder={founder} jobId={engJob} onJob={setEngJob} />}
        </section>
        <aside className="rail">
          {!phone && <NeedsYou scope={scope} founder={founder} />}
          <Feed order={sel.selected} scope={scope} onOpen={openStation} />
          <DroidStrip onOpen={openEngineering} />
        </aside>
      </main>
      {controls && <ControlsModal founder={founder} onClose={() => setControls(false)} />}
    </div>
  );
}
