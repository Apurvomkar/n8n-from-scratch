import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine } from '../src/engine.js';
import { Store } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import type { WorkflowDefinition } from '../src/types.js';

const workflow: WorkflowDefinition = {
  name: 'Simple',
  nodes: [
    { id: 'trigger', type: 'manualTrigger', parameters: {} },
    { id: 'log', type: 'log', parameters: { message: 'hello' } },
  ],
  connections: {
    trigger: { main: [[{ node: 'log', type: 'main', index: 0 }]] },
  },
};

function tempStore(): { store: Store; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'n8n-engine-test-'));
  const store = new Store(join(dir, 'test.db'));
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('store persists workflows and execution history', async () => {
  const { store, cleanup } = tempStore();
  try {
    const stored = store.upsertWorkflow('wf1', workflow);
    assert.equal(stored.name, 'Simple');
    assert.equal(store.countWorkflows(), 1);
    assert.ok(store.getWorkflow('wf1'));

    const result = await new WorkflowEngine().run(workflow);
    const execution = store.addExecution('wf1', result, new Date().toISOString());
    assert.equal(execution.status, 'success');
    assert.equal(store.listExecutions().length, 1);
    assert.equal(store.listExecutions({ workflowId: 'wf1' }).length, 1);
    assert.ok(store.getExecution(execution.id));

    assert.equal(store.deleteWorkflow('wf1'), true);
    assert.equal(store.countWorkflows(), 0);
  } finally {
    cleanup();
  }
});

test('API supports CRUD, webhook tokens and execution history', async () => {
  const { store, cleanup } = tempStore();
  const { app, scheduler } = createApp({ store, key: randomBytes(32), log: () => {} });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const health = await (await fetch(`${base}/health`)).json() as { status: string };
    assert.equal(health.status, 'ok');

    const created = await fetch(`${base}/api/workflows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...workflow,
        id: 'api1',
        settings: { webhookToken: 'tok' },
      }),
    });
    assert.equal(created.status, 201);

    const list = await (await fetch(`${base}/api/workflows`)).json() as unknown[];
    assert.equal(list.length, 1);

    const unauthorized = await fetch(`${base}/webhook/api1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`${base}/webhook/api1?token=tok`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(authorized.status, 200);
    const hookResult = await authorized.json() as { success: boolean; executionId: string };
    assert.equal(hookResult.success, true);

    const executions = await (await fetch(`${base}/api/executions`)).json() as unknown[];
    assert.equal(executions.length, 1);

    const single = await (await fetch(`${base}/api/executions/${hookResult.executionId}`)).json() as {
      workflowId: string;
    };
    assert.equal(single.workflowId, 'api1');

    const deleted = await fetch(`${base}/api/workflows/api1`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
  } finally {
    scheduler.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanup();
  }
});
