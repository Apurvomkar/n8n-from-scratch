/** Export workflows, encrypted credentials and execution history to JSON. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../src/server/store-factory.js';

const directory = process.env.BACKUP_DIR ?? join(process.cwd(), 'backups');
mkdirSync(directory, { recursive: true });

const store = createStore({
  sqlitePath: process.env.DB_PATH ?? join(process.cwd(), 'data', 'workflows.db'),
  postgresUrl: process.env.DATABASE_URL || undefined,
});
await store.init();

try {
  const [workflows, credentialRows, executions] = await Promise.all([
    store.listWorkflows(),
    store.listCredentials(),
    store.listExecutions({ limit: 500 }),
  ]);

  const credentials = (
    await Promise.all(credentialRows.map((row) => store.getCredential(row.id)))
  ).filter((row) => row !== undefined);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(directory, `workflows-${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        version: 1,
        createdAt: new Date().toISOString(),
        source: process.env.DATABASE_URL ? 'postgres' : 'sqlite',
        workflows,
        credentials,
        executions,
      },
      null,
      2,
    ),
    'utf-8',
  );

  console.log(`Backup written to ${file}`);
  console.log(
    `  ${workflows.length} workflows, ${credentials.length} credentials, ${executions.length} executions`,
  );
  console.log(
    'Credential secrets stay encrypted — keep ENCRYPTION_KEY to restore them.',
  );
} finally {
  await store.close();
}
