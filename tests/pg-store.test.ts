import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newDb } from 'pg-mem';
import { PgStore, type PoolLike } from '../src/server/pg-store.js';
import { WorkflowEngine } from '../src/engine.js';
import type { WorkflowDefinition } from '../src/types.js';

function createPgStore(): PgStore {
  const db = newDb();
  const adapter = db.adapters.createPg() as unknown as { Pool: new () => PoolLike };
  return new PgStore(new adapter.Pool());
}

const workflow: WorkflowDefinition = {
  name: 'Postgres workflow',
  nodes: [
    { id: 'trigger', type: 'manualTrigger', parameters: {} },
    { id: 'log', type: 'log', parameters: { message: 'hi' } },
  ],
  connections: {
    trigger: { main: [[{ node: 'log', type: 'main', index: 0 }]] },
  },
};

test('PgStore persists workflows across reloads', async () => {
  const store = createPgStore();
  await store.init();
  try {
    await store.upsertWorkflow('wf1', workflow);
    assert.equal(await store.countWorkflows(), 1);

    const reloaded = await store.getWorkflow('wf1');
    assert.equal(reloaded?.name, 'Postgres workflow');
    assert.equal(reloaded?.definition.nodes.length, 2);

    await store.upsertWorkflow('wf1', { ...workflow, name: 'Renamed' });
    assert.equal((await store.getWorkflow('wf1'))?.name, 'Renamed');
    assert.equal(await store.countWorkflows(), 1);

    const list = await store.listWorkflows();
    assert.equal(list.length, 1);
    assert.equal(await store.deleteWorkflow('wf1'), true);
    assert.equal(await store.countWorkflows(), 0);
  } finally {
    await store.close();
  }
});

test('PgStore records executions and credentials', async () => {
  const store = createPgStore();
  await store.init();
  try {
    const result = await new WorkflowEngine().run(workflow);
    const execution = await store.addExecution('wf1', result, new Date().toISOString());
    assert.equal(execution.status, 'success');
    assert.equal((await store.listExecutions()).length, 1);
    assert.equal((await store.listExecutions({ workflowId: 'wf1' })).length, 1);
    assert.ok(await store.getExecution(execution.id));

    await store.addCredential('c1', 'API key', 'apiKey', 'encrypted-blob');
    assert.equal((await store.listCredentials())[0].name, 'API key');
    assert.ok(!('data' in (await store.listCredentials())[0]));
    assert.equal((await store.getCredential('c1'))?.data, 'encrypted-blob');
    await store.updateCredential('c1', { name: 'Renamed key' });
    assert.equal((await store.getCredential('c1'))?.name, 'Renamed key');
    assert.equal(await store.deleteCredential('c1'), true);
    assert.equal((await store.listCredentials()).length, 0);
  } finally {
    await store.close();
  }
});
