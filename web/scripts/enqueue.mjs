import { call, founderToken } from '../../module/test/client.mjs';
const kind = process.argv[2];
const r = await call(founderToken(), 'enqueue_task', [kind, 'droid_runner', '{"from":"web live test"}']);
console.log(r.status, r.body);
