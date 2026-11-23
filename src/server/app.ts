/** HTTP API: workflow CRUD, execution, webhooks, history and scheduling. */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';
import { WorkflowEngine } from '../engine.js';
import { validateWorkflow } from '../workflow.js';
import type { Item, WorkflowDefinition } from '../types.js';
import type { WorkflowStore } from './store-types.js';
import { decrypt, encrypt } from './crypto.js';
import { Scheduler } from './scheduler.js';
import { listNodes } from '../nodes/index.js';

type CreateBody = WorkflowDefinition & { id?: string };

export interface AppOptions {
  store: WorkflowStore;
  key: Buffer;
  log?: (message: string) => void;
  /** Built UI directory to serve (e.g. ui/dist). Omit for API-only mode. */
  uiDist?: string;
}

export interface AppBundle {
  app: Express;
  scheduler: Scheduler;
  runWorkflow: (id: string, items?: Item[]) => Promise<{
    success: boolean;
    executionId: string;
    records: unknown[];
    ms: number;
  }>;
}

function asItems(body: unknown): Item[] {
  if (Array.isArray(body)) return body as Item[];
  if (body && typeof body === 'object' && 'items' in body) {
    const items = (body as { items: unknown }).items;
    if (Array.isArray(items)) return items as Item[];
  }
  return [];
}

function credentialMeta(row: {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createApp(options: AppOptions): AppBundle {
  const { store, key } = options;
  const log = options.log ?? (() => {});
  const uiIndex = options.uiDist ? join(options.uiDist, 'index.html') : undefined;
  const serveUi = Boolean(uiIndex && existsSync(uiIndex!));
  const engine = new WorkflowEngine();

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  if (serveUi && options.uiDist) {
    app.use(express.static(options.uiDist));
  }

  const runWorkflow = async (id: string, items: Item[] = []) => {
    const stored = await store.getWorkflow(id);
    if (!stored) {
      throw new Error(`Workflow '${id}' not found`);
    }
    const startedAt = new Date().toISOString();
    const result = await engine.run(stored.definition, {
      initialItems: items.length > 0 ? items : stored.definition.settings?.defaultItems ?? [],
      resolveCredential: async (credentialId) => {
        const row = await store.getCredential(credentialId);
        if (!row) return undefined;
        try {
          return JSON.parse(decrypt(row.data, key)) as Record<string, any>;
        } catch {
          return undefined;
        }
      },
      onEvent: (event) => {
        if (event.type === 'node-error') log(event.message);
      },
    });
    const execution = await store.addExecution(id, result, startedAt);
    return {
      success: result.success,
      executionId: execution.id,
      records: execution.records,
      ms: result.ms,
    };
  };

  const scheduler = new Scheduler({
    store,
    runWorkflow: async (id) => {
      await runWorkflow(id);
    },
    log,
  });

  // ------------------------------------------------------------------ info
  app.get('/', (_req, res) => {
    if (serveUi && uiIndex) {
      res.sendFile(uiIndex);
      return;
    }
    res.json({
      name: 'n8n-from-scratch API',
      endpoints: [
        'GET  /health',
        'GET  /api/nodes',
        'GET  /api/workflows',
        'POST /api/workflows',
        'GET  /api/workflows/:id',
        'PUT  /api/workflows/:id',
        'DELETE /api/workflows/:id',
        'POST /api/workflows/:id/run',
        'GET  /api/executions',
        'GET  /api/executions/:id',
        'GET  /api/credentials',
        'POST /api/credentials',
        'POST /webhook/:id',
      ],
    });
  });

  app.get('/health', async (_req, res) => {
    res.json({
      status: 'ok',
      workflows: await store.countWorkflows(),
      scheduled: scheduler.size,
    });
  });

  // ------------------------------------------------------------- node types
  app.get('/api/nodes', (_req, res) => {
    res.json(
      listNodes().map((node) => ({
        type: node.type,
        description: node.description,
        inputs: node.inputs,
        outputs: node.outputs,
        trigger: Boolean(node.trigger),
        credentialTypes: node.credentialTypes ?? [],
      })),
    );
  });

  // -------------------------------------------------------------- workflows
  app.get('/api/workflows', async (_req, res) => {
    const workflows = await store.listWorkflows();
    res.json(
      workflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        scheduled: Boolean(workflow.definition.settings?.schedule),
        nodes: workflow.definition.nodes.length,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      })),
    );
  });

  app.post('/api/workflows', async (req, res) => {
    const body = req.body as CreateBody | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ errors: ['Request body must be a workflow object'] });
      return;
    }
    const errors = validateWorkflow(body);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }
    const id = body.id ? String(body.id) : randomUUID();
    const stored = await store.upsertWorkflow(id, body);
    const sync = await scheduler.sync();
    res.status(201).json({ ...stored, scheduleErrors: sync.errors });
  });

  app.get('/api/workflows/:id', async (req, res) => {
    const stored = await store.getWorkflow(req.params.id);
    if (!stored) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    res.json(stored);
  });

  app.put('/api/workflows/:id', async (req, res) => {
    if (!(await store.getWorkflow(req.params.id))) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    const body = req.body as WorkflowDefinition | undefined;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ errors: ['Request body must be a workflow object'] });
      return;
    }
    const errors = validateWorkflow(body);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }
    const stored = await store.upsertWorkflow(req.params.id, body);
    const sync = await scheduler.sync();
    res.json({ ...stored, scheduleErrors: sync.errors });
  });

  app.delete('/api/workflows/:id', async (req, res) => {
    const removed = await store.deleteWorkflow(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }
    await scheduler.sync();
    res.status(204).end();
  });

  app.post('/api/workflows/:id/run', async (req, res) => {
    try {
      const result = await runWorkflow(req.params.id, asItems(req.body));
      res.json(result);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  // -------------------------------------------------------------- executions
  app.get('/api/executions', async (req, res) => {
    const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    res.json(await store.listExecutions({ workflowId, limit }));
  });

  app.get('/api/executions/:id', async (req, res) => {
    const execution = await store.getExecution(req.params.id);
    if (!execution) {
      res.status(404).json({ error: 'Execution not found' });
      return;
    }
    res.json(execution);
  });

  // ------------------------------------------------------------- credentials
  app.get('/api/credentials', async (_req, res) => {
    res.json(await store.listCredentials());
  });

  app.post('/api/credentials', async (req, res) => {
    const { name, type, data } = req.body ?? {};
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      typeof type !== 'string' ||
      !type.trim() ||
      typeof data !== 'object' ||
      data === null
    ) {
      res.status(400).json({ error: 'name, type and data (object) are required' });
      return;
    }
    const row = await store.addCredential(
      randomUUID(),
      name.trim(),
      type.trim(),
      encrypt(JSON.stringify(data), key),
    );
    res.status(201).json(credentialMeta(row));
  });

  app.get('/api/credentials/:id', async (req, res) => {
    const row = await store.getCredential(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.json(credentialMeta(row));
  });

  app.put('/api/credentials/:id', async (req, res) => {
    const body = req.body as { name?: string; type?: string; data?: Record<string, any> };
    const encrypted =
      body?.data && typeof body.data === 'object'
        ? encrypt(JSON.stringify(body.data), key)
        : undefined;
    const updated = await store.updateCredential(req.params.id, {
      ...(typeof body?.name === 'string' ? { name: body.name } : {}),
      ...(typeof body?.type === 'string' ? { type: body.type } : {}),
      ...(encrypted ? { data: encrypted } : {}),
    });
    if (!updated) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.json(credentialMeta(updated));
  });

  app.delete('/api/credentials/:id', async (req, res) => {
    const removed = await store.deleteCredential(req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Credential not found' });
      return;
    }
    res.status(204).end();
  });

  // ---------------------------------------------------------------- webhooks
  app.post('/webhook/:id', async (req, res) => {
    const stored = await store.getWorkflow(req.params.id);
    if (!stored) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    const expectedToken = stored.definition.settings?.webhookToken;
    if (expectedToken) {
      const provided = req.query.token ?? req.header('x-webhook-token');
      if (provided !== String(expectedToken)) {
        res.status(401).json({ error: 'Invalid webhook token' });
        return;
      }
    }

    try {
      const payload = req.body ?? {};
      const result = await runWorkflow(req.params.id, [{ json: payload }]);
      res.json({
        success: result.success,
        executionId: result.executionId,
        records: result.records,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });

  if (serveUi && uiIndex) {
    // React Flow editor uses client-side routes; send unknown GET paths to the SPA.
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      if (req.path.startsWith('/api/') || req.path.startsWith('/webhook/') || req.path === '/health') {
        next();
        return;
      }
      res.sendFile(uiIndex);
    });
  }

  return { app, scheduler, runWorkflow };
}
