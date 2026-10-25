import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import { App } from './App';
import './styles.css';
import { markReady } from './ready';

const HOST = import.meta.env.VITE_SPACETIME_HOST ?? 'https://maincloud.spacetimedb.com';
const DB = import.meta.env.VITE_SPACETIME_DB ?? 'forge';
const TOKEN_KEY = `forge.token.${DB}`;

const builder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB)
  .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
  .onConnect((conn, _identity, token) => {
    localStorage.setItem(TOKEN_KEY, token);
    // Two snapshots: the small tables a first paint needs, then the ones that grow with every order
    // (event and value_record alone are three quarters of the data). Maincloud takes seconds for the
    // large ones, and one combined subscription kept the whole page blank until the last byte arrived.
    conn.subscriptionBuilder().onApplied(() => markReady('core')).subscribe([
      tables.config, tables.staff, tables.customer, tables.api, tables.apiVersion, tables.apiRetired, tables.orders, tables.canaryOrder,
      tables.approval, tables.budget, tables.books, tables.compileJob, tables.ticket, tables.apiCost, tables.refund, tables.challenge, tables.bonus,
    ]);
    conn.subscriptionBuilder().onApplied(() => markReady('all')).subscribe([
      tables.task, tables.run, tables.event, tables.valueRecord, tables.evidence, tables.gateCheck, tables.runCost,
    ]);
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={builder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
);
