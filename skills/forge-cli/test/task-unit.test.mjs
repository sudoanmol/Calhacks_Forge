import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../forge.mjs', import.meta.url));
test('an empty dispatch orderId falls back to the orderId in task input', () => {
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'task', JSON.stringify({
    kind: 'audit', taskId: '3', orderId: '', input: { orderId: '7' },
  })], { env: { ...process.env, FORGE_SEAT_TOKEN: 'unused-local-task-command', FORGE_DB_URL: 'http://127.0.0.1:3019/v1/database/forge-audit-isolation' }, encoding: 'utf8' }));
  assert.equal(result.orderId, '7');
  assert.ok(result.next.some((s) => s.includes('forge verdict 7')));
});
