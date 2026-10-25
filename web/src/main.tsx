import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, tables } from './module_bindings';
import { App } from './App';
import './styles.css';

const HOST = import.meta.env.VITE_SPACETIME_HOST ?? 'https://maincloud.spacetimedb.com';
const DB = import.meta.env.VITE_SPACETIME_DB ?? 'forge';
const TOKEN_KEY = `forge.token.${DB}`;

const builder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB)
  .withToken(localStorage.getItem(TOKEN_KEY) ?? undefined)
  .onConnect((conn, _identity, token) => {
    localStorage.setItem(TOKEN_KEY, token);
    conn.subscriptionBuilder().subscribe([
      tables.config, tables.staff, tables.task, tables.event, tables.run, tables.customer, tables.api, tables.apiVersion,
      tables.gateCheck, tables.orders, tables.ticket, tables.valueRecord, tables.evidence, tables.challenge,
      tables.approval, tables.budget, tables.bonus, tables.books, tables.canaryOrder, tables.runCost, tables.apiCost, tables.apiRetired, tables.compileJob,
    ]);
  });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={builder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>,
);
