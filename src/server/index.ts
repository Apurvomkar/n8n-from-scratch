/** Server entry point: seed workflows, start HTTP API and scheduler. */

import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app.js';
import { createStore } from './store-factory.js';
import { resolveEncryptionKey } from './crypto.js';
import { loadWorkflow, validateWorkflow } from '../workflow.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'workflows.db');
const postgresUrl = process.env.DATABASE_URL || undefined;

const store = createStore({ sqlitePath: dbPath, postgresUrl });
await store.init();
const key = resolveEncryptionKey(
  process.env.KEY_PATH ?? join(process.cwd(), 'data', '.encryption-key'),
);

async function seedWorkflows(): Promise<number> {
  if ((await store.countWorkflows()) > 0) return 0;
  const directory = join(process.cwd(), 'workflows');
  let seeded = 0;
  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.json')) continue;
    try {
      const workflow = loadWorkflow(join(directory, file));
      if (validateWorkflow(workflow).length > 0) continue;
      await store.upsertWorkflow(file.replace(/\.json$/, ''), workflow);
      seeded += 1;
    } catch (error) {
      console.warn(`[seed] Skipped '${file}': ${(error as Error).message}`);
    }
  }
  return seeded;
}

const seeded = await seedWorkflows();
const apiKey = process.env.API_KEY || undefined;
const { app, scheduler } = createApp({
  store,
  key,
  apiKey,
  log: console.log,
  uiDist: join(process.cwd(), 'ui', 'dist'),
});
const sync = await scheduler.sync();
for (const error of sync.errors) {
  console.warn(`[scheduler] ${error}`);
}

const server = createServer(app);
server.listen(port, async () => {
  console.log(`n8n-from-scratch API listening on http://localhost:${port}`);
  console.log(`  storage: ${postgresUrl ? 'Postgres' : `SQLite (${dbPath})`}`);
  console.log(`  workflows: ${await store.countWorkflows()}${seeded > 0 ? ` (seeded ${seeded})` : ''}`);
  console.log(`  scheduled: ${scheduler.size}`);
  console.log(`  API auth: ${apiKey ? 'enabled (bearer token)' : 'disabled — set API_KEY to protect /api'}`);
});

function shutdown(): void {
  scheduler.stop();
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
