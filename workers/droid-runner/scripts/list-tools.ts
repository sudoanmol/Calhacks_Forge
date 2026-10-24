import { AutonomyLevel, createSession } from '@factory/droid-sdk/node';
const s = await createSession({ cwd: process.cwd(), autonomyLevel: AutonomyLevel.Off });
const tools = await s.listTools();
for (const t of tools as Array<{ id: string; category: string; allowed: boolean }>) console.log(`${t.id}\t${t.category}\t${t.allowed}`);
await s.close();
