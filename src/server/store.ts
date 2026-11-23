/** SQLite-backed persistence (default, zero-config storage). */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
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

export type {
  CredentialMeta,
  CredentialRow,
  ListExecutionsOptions,
  StoredExecution,
  StoredWorkflow,
} from './store-types.js';

interface WorkflowRow {
  id: string;
  name: string;
  definition: string;
  createdAt: string;
  updatedAt: string;
}

interface ExecutionRow {
  id: string;
  workflowId: string;
  workflowName: string;
  status: string;
  startedAt: string;
  finishedAt: string;
  ms: number;
  records: string;
  outputs: string;
  error: string | null;
}

export class Store implements WorkflowStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        definition TEXT NOT NULL,
        createdAt  TEXT NOT NULL,
        updatedAt  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS executions (
        id           TEXT PRIMARY KEY,
        workflowId   TEXT NOT NULL,
        workflowName TEXT NOT NULL,
        status       TEXT NOT NULL,
        startedAt    TEXT NOT NULL,
        finishedAt   TEXT NOT NULL,
        ms           INTEGER NOT NULL,
        records      TEXT NOT NULL,
        outputs      TEXT NOT NULL,
        error        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_executions_workflow ON executions(workflowId);
      CREATE TABLE IF NOT EXISTS credentials (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        type      TEXT NOT NULL,
        data      TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  async init(): Promise<void> {
    // Schema is created synchronously in the constructor.
  }

  private toWorkflow(row: WorkflowRow): StoredWorkflow {
    return {
      id: row.id,
      name: row.name,
      definition: JSON.parse(row.definition) as WorkflowDefinition,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toExecution(row: ExecutionRow): StoredExecution {
    const execution: StoredExecution = {
      id: row.id,
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      status: row.status === 'success' ? 'success' : 'failure',
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      ms: row.ms,
      records: JSON.parse(row.records),
      outputs: JSON.parse(row.outputs),
    };
    if (row.error) execution.error = row.error;
    return execution;
  }

  async countWorkflows(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM workflows').get() as { count: number };
    return row.count;
  }

  async listWorkflows(): Promise<StoredWorkflow[]> {
    const rows = this.db
      .prepare('SELECT * FROM workflows ORDER BY updatedAt DESC')
      .all() as unknown as WorkflowRow[];
    return rows.map((row) => this.toWorkflow(row));
  }

  async getWorkflow(id: string): Promise<StoredWorkflow | undefined> {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as
      | WorkflowRow
      | undefined;
    return row ? this.toWorkflow(row) : undefined;
  }

  async upsertWorkflow(id: string, definition: WorkflowDefinition): Promise<StoredWorkflow> {
    const existing = await this.getWorkflow(id);
    const now = new Date().toISOString();
    const createdAt = existing?.createdAt ?? now;
    this.db
      .prepare(
        `INSERT INTO workflows (id, name, definition, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name,
           definition = excluded.definition, updatedAt = excluded.updatedAt`,
      )
      .run(id, definition.name, JSON.stringify(definition), createdAt, now);
    return (await this.getWorkflow(id))!;
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id).changes > 0;
  }

  async addExecution(
    workflowId: string,
    result: RunResult,
    startedAt: string,
  ): Promise<StoredExecution> {
    const id = randomUUID();
    const finishedAt = new Date().toISOString();
    const error = result.records.find((record) => record.status === 'error')?.error;
    this.db
      .prepare(
        `INSERT INTO executions
           (id, workflowId, workflowName, status, startedAt, finishedAt, ms, records, outputs, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );
    return (await this.getExecution(id))!;
  }

  async getExecution(id: string): Promise<StoredExecution | undefined> {
    const row = this.db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as
      | ExecutionRow
      | undefined;
    return row ? this.toExecution(row) : undefined;
  }

  async listExecutions(options: ListExecutionsOptions = {}): Promise<StoredExecution[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    let sql = 'SELECT * FROM executions';
    const params: Array<string | number> = [];
    if (options.workflowId) {
      sql += ' WHERE workflowId = ?';
      params.push(options.workflowId);
    }
    sql += ' ORDER BY startedAt DESC LIMIT ?';
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as unknown as ExecutionRow[];
    return rows.map((row) => this.toExecution(row));
  }

  // ------------------------------------------------------------- credentials
  async listCredentials(): Promise<CredentialMeta[]> {
    return this.db
      .prepare('SELECT id, name, type, createdAt, updatedAt FROM credentials ORDER BY updatedAt DESC')
      .all() as unknown as CredentialMeta[];
  }

  async getCredential(id: string): Promise<CredentialRow | undefined> {
    return this.db.prepare('SELECT * FROM credentials WHERE id = ?').get(id) as
      | CredentialRow
      | undefined;
  }

  async addCredential(
    id: string,
    name: string,
    type: string,
    encryptedData: string,
  ): Promise<CredentialRow> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO credentials (id, name, type, data, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, type, encryptedData, now, now);
    return (await this.getCredential(id))!;
  }

  async updateCredential(
    id: string,
    changes: { name?: string; type?: string; data?: string },
  ): Promise<CredentialRow | undefined> {
    const current = await this.getCredential(id);
    if (!current) return undefined;
    this.db
      .prepare('UPDATE credentials SET name = ?, type = ?, data = ?, updatedAt = ? WHERE id = ?')
      .run(
        changes.name ?? current.name,
        changes.type ?? current.type,
        changes.data ?? current.data,
        new Date().toISOString(),
        id,
      );
    return this.getCredential(id);
  }

  async deleteCredential(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM credentials WHERE id = ?').run(id).changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
