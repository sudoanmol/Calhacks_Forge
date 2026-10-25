#!/bin/sh
# A fresh unregistered identity cannot change the budget. No project keys are loaded.
set -eu
node --input-type=module <<'JS'
const host = process.env.SPACETIME_HOST ?? 'https://maincloud.spacetimedb.com';
const db = process.env.SPACETIME_DB ?? 'forge';
const identity = await fetch(`${host}/v1/identity`, { method: 'POST' });
if (!identity.ok) throw new Error(`identity HTTP ${identity.status}`);
const { token } = await identity.json();
const response = await fetch(`${host}/v1/database/${encodeURIComponent(db)}/call/set_budget_cap`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '[0]',
});
console.log(`TEST MODE · unknown identity · HTTP ${response.status}`);
console.log(await response.text());
if (response.status !== 530) process.exitCode = 1;
JS
