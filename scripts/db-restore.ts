/** Restore a JSON backup into the store selected by DB_PATH / DATABASE_URL. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from '../src/server/store-factory.js';
import type { Item, RunResult } from '../src/types.js';
import type { StoredExecution, StoredWorkflow } from '../src/server/store-types.js';
import type { CredentialRow } from '../src/server/store-types.js';

interface Backup {
  version: number;
  workflows: StoredWorkflow[];
  credentials: CredentialRow[];
  executions: StoredExecution[];
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run db:restore -- <backup-file.json>');
  process.exit(1);
}

const backup = JSON.parse(readFileSync(file, 'utf-8')) as Backup;
if (backup.version !== 1 || !Array.isArray(backup.workflows)) {
  throw new Error('Unrecognised backup format');
}

const store = createStore({
  sqlitePath: process.env.DB_PATH ?? join(process.cwd(), 'data', 'workflows.db'),
  postgresUrl: process.env.DATABASE_URL || undefined,
});
await store.init();

try {
  for (const workflow of backup.workflows) {
    await store.upsertWorkflow(workflow.id, workflow.definition);
  }
  for (const credential of backup.credentials ?? []) {
    if (await store.getCredential(credential.id)) {
      await store.updateCredential(credential.id, {
        name: credential.name,
        type: credential.type,
        data: credential.data,
      });
    } else {
      await store.addCredential(
        credential.id,
        credential.name,
        credential.type,
        credential.data,
      );
    }
  }
  for (const execution of backup.executions ?? []) {
    const result: RunResult = {
      workflow: execution.workflowName,
      success: execution.status === 'success',
      records: execution.records as RunResult['records'],
      outputs: execution.outputs as Record<string, Item[][]>,
      ms: execution.ms,
    };
    await store.addExecution(execution.workflowId, result, execution.startedAt);
  }

  console.log(
    `Restored ${backup.workflows.length} workflows, ${(backup.credentials ?? []).length} credentials, ${(backup.executions ?? []).length} executions.`,
  );
  console.log('Execution IDs are regenerated on restore; workflow and credential IDs are preserved.');
} finally {
  await store.close();
}
