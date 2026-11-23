import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decrypt, encrypt } from '../src/server/crypto.js';
import { Store } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';
import { WorkflowEngine } from '../src/engine.js';
import { registerNode } from '../src/nodes/index.js';
import type { WorkflowDefinition } from '../src/types.js';

function tempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'n8n-creds-test-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('credential secrets encrypt and decrypt with AES-GCM', () => {
  const key = randomBytes(32);
  const secret = JSON.stringify({ token: 'super-secret', username: 'ada' });
  const encrypted = encrypt(secret, key);

  assert.notEqual(encrypted, secret);
  assert.ok(!encrypted.includes('super-secret'));
  assert.equal(decrypt(encrypted, key), secret);
  assert.throws(() => decrypt(encrypted, randomBytes(32)));
});

test('credential API stores secrets encrypted and never returns them', async () => {
  const { dir, cleanup } = tempDir();
  const key = randomBytes(32);
  const store = new Store(join(dir, 'test.db'));
  const { app, scheduler } = createApp({ store, key, log: () => {} });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const response = await fetch(`${base}/api/credentials`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Slack',
        type: 'slackApi',
        data: { token: 'xoxb-secret-value' },
      }),
    });
    assert.equal(response.status, 201);
    const created = (await response.json()) as Record<string, any>;
    assert.equal(created.type, 'slackApi');
    assert.ok(!('data' in created));
    assert.ok(!JSON.stringify(created).includes('xoxb-secret-value'));

    const row = (await store.getCredential(created.id as string))!;
    assert.ok(!row.data.includes('xoxb-secret-value'));
    assert.equal(JSON.parse(decrypt(row.data, key)).token, 'xoxb-secret-value');

    const list = (await (await fetch(`${base}/api/credentials`)).json()) as unknown[];
    assert.equal(list.length, 1);
    assert.ok(!JSON.stringify(list).includes('xoxb-secret-value'));
  } finally {
    scheduler.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    cleanup();
  }
});

test('engine resolves credentials into the node execution context', async () => {
  registerNode({
    type: 'credentialProbe',
    description: 'Test node exposing a resolved credential',
    inputs: 1,
    outputs: 1,
    credentialTypes: ['demo'],
    execute(_inputs, ctx) {
      return [[{ json: ctx.credentials.demo }]];
    },
  });

  const workflow: WorkflowDefinition = {
    name: 'probe',
    nodes: [
      { id: 'trigger', type: 'manualTrigger', parameters: {} },
      {
        id: 'probe',
        type: 'credentialProbe',
        parameters: {},
        credentials: { demo: 'cred-1' },
      },
    ],
    connections: {
      trigger: { main: [[{ node: 'probe', type: 'main', index: 0 }]] },
    },
  };

  const result = await new WorkflowEngine().run(workflow, {
    resolveCredential: (id) => (id === 'cred-1' ? { token: 'resolved' } : undefined),
  });
  assert.equal(result.success, true);
  assert.equal(result.outputs.probe[0][0].json.token, 'resolved');
});

test('sqlite node queries a database from a credential', async () => {
  const { dir, cleanup } = tempDir();
  const dbPath = join(dir, 'data.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE people (name TEXT); INSERT INTO people (name) VALUES (\'Ada\'), (\'Grace\');');
  db.close();

  const workflow: WorkflowDefinition = {
    name: 'sql',
    nodes: [
      {
        id: 'trigger',
        type: 'manualTrigger',
        parameters: {},
      },
      {
        id: 'query',
        type: 'sqlite',
        parameters: { query: 'SELECT name FROM people ORDER BY name' },
        credentials: { sqlite: 'db-1' },
      },
    ],
    connections: {
      trigger: { main: [[{ node: 'query', type: 'main', index: 0 }]] },
    },
  };

  try {
    const result = await new WorkflowEngine().run(workflow, {
      resolveCredential: (id) => (id === 'db-1' ? { databasePath: dbPath } : undefined),
    });
    assert.equal(result.success, true);
    assert.deepEqual(
      result.outputs.query[0].map((item) => item.json.name),
      ['Ada', 'Grace'],
    );
  } finally {
    cleanup();
  }
});
