/** Postgres-backed implementation of WorkflowStore (for hosted deployments). */

import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { RunResult, WorkflowDefinition } from '../types.js';
import type {
  CredentialMeta,
  CredentialRow,
  ListExecutionsOptions,
  StoredExecution,
  StoredWorkflow,
  WorkflowStore,
} from './store-types.js';

/** Minimal shape shared by node-postgres and in-memory test adapters. */
export interface PoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
  end(): Promise<void>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    definition JSONB NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    ms INTEGER NOT NULL,
    records JSONB NOT NULL,
    outputs JSONB NOT NULL,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflow_id);
  CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function parseJson<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

export class PgStore implements WorkflowStore {
  private readonly pool: PoolLike;

  constructor(connectionStringOrPool: string | PoolLike) {
    this.pool =
      typeof connectionStringOrPool === 'string'
        ? (new Pool({ connectionString: connectionStringOrPool }) as unknown as PoolLike)
        : connectionStringOrPool;
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private toWorkflow(row: any): StoredWorkflow {
    return {
      id: row.id,
      name: row.name,
      definition: parseJson<WorkflowDefinition>(row.definition),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toExecution(row: any): StoredExecution {
    const execution: StoredExecution = {
      id: row.id,
      workflowId: row.workflow_id,
      workflowName: row.workflow_name,
      status: row.status === 'success' ? 'success' : 'failure',
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      ms: Number(row.ms),
      records: parseJson<unknown[]>(row.records),
      outputs: parseJson<Record<string, unknown>>(row.outputs),
    };
    if (row.error) execution.error = row.error;
    return execution;
  }

  async countWorkflows(): Promise<number> {
    const result = await this.pool.query('SELECT COUNT(*) AS count FROM workflows');
    return Number(result.rows[0].count);
  }

  async listWorkflows(): Promise<StoredWorkflow[]> {
    const result = await this.pool.query('SELECT * FROM workflows ORDER BY updated_at DESC');
    return result.rows.map((row) => this.toWorkflow(row));
  }

  async getWorkflow(id: string): Promise<StoredWorkflow | undefined> {
    const result = await this.pool.query('SELECT * FROM workflows WHERE id = $1', [id]);
    return result.rows[0] ? this.toWorkflow(result.rows[0]) : undefined;
  }

  async upsertWorkflow(id: string, definition: WorkflowDefinition): Promise<StoredWorkflow> {
    const existing = await this.getWorkflow(id);
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO workflows (id, name, definition, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name,
         definition = EXCLUDED.definition, updated_at = EXCLUDED.updated_at`,
      [id, definition.name, JSON.stringify(definition), existing?.createdAt ?? now, now],
    );
    return (await this.getWorkflow(id))!;
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM workflows WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async addExecution(
    workflowId: string,
    result: RunResult,
    startedAt: string,
  ): Promise<StoredExecution> {
    const id = randomUUID();
    const finishedAt = new Date().toISOString();
    const error = result.records.find((record) => record.status === 'error')?.error;
    await this.pool.query(
      `INSERT INTO executions
         (id, workflow_id, workflow_name, status, started_at, finished_at, ms, records, outputs, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        workflowId,
        result.workflow,
        result.success ? 'success' : 'failure',
        startedAt,
        finishedAt,
        result.ms,
        JSON.stringify(result.records),
        JSON.stringify(result.outputs),
        error ?? null,
      ],
    );
    return (await this.getExecution(id))!;
  }

  async getExecution(id: string): Promise<StoredExecution | undefined> {
    const result = await this.pool.query('SELECT * FROM executions WHERE id = $1', [id]);
    return result.rows[0] ? this.toExecution(result.rows[0]) : undefined;
  }

  async listExecutions(options: ListExecutionsOptions = {}): Promise<StoredExecution[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    let sql = 'SELECT * FROM executions';
    const params: unknown[] = [];
    if (options.workflowId) {
      sql += ' WHERE workflow_id = $1';
      params.push(options.workflowId);
    }
    sql += ` ORDER BY started_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const result = await this.pool.query(sql, params);
    return result.rows.map((row) => this.toExecution(row));
  }

  // ------------------------------------------------------------- credentials
  async listCredentials(): Promise<CredentialMeta[]> {
    const result = await this.pool.query(
      'SELECT id, name, type, created_at, updated_at FROM credentials ORDER BY updated_at DESC',
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getCredential(id: string): Promise<CredentialRow | undefined> {
    const result = await this.pool.query('SELECT * FROM credentials WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      data: row.data,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async addCredential(
    id: string,
    name: string,
    type: string,
    encryptedData: string,
  ): Promise<CredentialRow> {
    const now = new Date().toISOString();
    await this.pool.query(
      `INSERT INTO credentials (id, name, type, data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, type, encryptedData, now, now],
    );
    return (await this.getCredential(id))!;
  }

  async updateCredential(
    id: string,
    changes: { name?: string; type?: string; data?: string },
  ): Promise<CredentialRow | undefined> {
    const current = await this.getCredential(id);
    if (!current) return undefined;
    await this.pool.query(
      'UPDATE credentials SET name = $1, type = $2, data = $3, updated_at = $4 WHERE id = $5',
      [
        changes.name ?? current.name,
        changes.type ?? current.type,
        changes.data ?? current.data,
        new Date().toISOString(),
        id,
      ],
    );
    return this.getCredential(id);
  }

  async deleteCredential(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM credentials WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}
