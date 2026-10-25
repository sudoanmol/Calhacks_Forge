import { useState } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import { useTable } from './db';
import { tables } from './module_bindings';
import { OfficeTab, useMedia, useOrderSelection } from './Office';
import { ApisTab } from './Apis';
import { ControlsModal } from './Controls';
import { EngineeringTab } from './Engineering';
import { OrgChartTab } from './OrgChart';
import { Header } from './Header';
import { OrderHero } from './OrderHero';
import { Feed } from './Feed';
import { NeedsYou } from './NeedsYou';
import { DroidStrip } from './DroidStrip';
import { ReplayBar, useReplay } from './ReplayBar';
import { useScope } from './scope';
import type { StationId } from './scene';

const TABS = ['Office', 'Org chart', 'Catalog', 'Engineering'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Office');
  const [controls, setControls] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [engJob, setEngJob] = useState<bigint | null>(null);
  const openEngineering = (ticketId: bigint) => { setEngJob(ticketId); setTab('Engineering'); };
  const scope = useScope(showTest);
  const sel = useOrderSelection(scope);
  const replay = useReplay(sel.selected);
  const cursor = replay.state.cursor;
  const connection = useSpacetimeDB();
  const [staff] = useTable(tables.staff);
  const identity = connection.identity;
  const founder = connection.isActive && identity !== undefined && staff.some((s) => s.role === 'founder' && s.identity.isEqual(identity));
  const openStation = (id: StationId) => { setTab('Office'); sel.setDrawer(id); };
  // The phone stacks Needs you above the order headline; the desktop keeps it at the top of the rail.
  const phone = useMedia('(max-width: 800px)');
  // The phone layout has no org chart (spec §5); a chart left open when the window narrows falls back to Office.
  const tabs: readonly Tab[] = phone ? TABS.filter((t) => t !== 'Org chart') : TABS;
  const shown: Tab = tabs.includes(tab) ? tab : 'Office';
  return (
    <div className="app">
      <Header scope={scope} founder={founder} onControls={() => setControls(true)} />
      {phone && <NeedsYou scope={scope} founder={founder} />}
      {shown === 'Office' && sel.selected && <OrderHero order={sel.selected} scope={scope} founder={founder} cursor={cursor} />}
      {shown === 'Office' && sel.selected && <ReplayBar replay={replay} />}
      <main>
        <section className="panel mainpanel">
          <nav className="tabs" role="tablist">
            {tabs.map((t) => (
              <button key={t} role="tab" aria-selected={t === shown} className={t === shown ? 'on' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>{t}</button>
            ))}
          </nav>
          {shown === 'Office'
            ? <OfficeTab scope={scope} setShowTest={setShowTest} sel={sel} cursor={cursor} />
            : shown === 'Org chart' ? <OrgChartTab scope={scope} setShowTest={setShowTest} onStation={openStation} onEngineering={() => setTab('Engineering')} onControls={() => setControls(true)} />
            : shown === 'Catalog' ? <ApisTab scope={scope} onEngineering={() => setTab('Engineering')} /> : <EngineeringTab founder={founder} jobId={engJob} onJob={setEngJob} />}
        </section>
        <aside className="rail">
          {!phone && <NeedsYou scope={scope} founder={founder} />}
          <Feed order={sel.selected} scope={scope} onOpen={openStation} cursor={shown === 'Office' ? cursor : null} />
          <DroidStrip onOpen={openEngineering} />
        </aside>
      </main>
      {controls && <ControlsModal founder={founder} onClose={() => setControls(false)} />}
    </div>
  );
}
