/** Shared persistence contract implemented by SQLite and Postgres stores. */

import type { RunResult, WorkflowDefinition } from '../types.js';

export interface StoredWorkflow {
  id: string;
  name: string;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface StoredExecution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'failure';
  startedAt: string;
  finishedAt: string;
  ms: number;
  records: unknown[];
  outputs: Record<string, unknown>;
  error?: string;
}

export interface CredentialMeta {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRow extends CredentialMeta {
  /** Encrypted payload — never exposed through the API. */
  data: string;
}

export interface ListExecutionsOptions {
  workflowId?: string;
  limit?: number;
}

export interface WorkflowStore {
  /** Create schema if needed. Safe to call repeatedly. */
  init(): Promise<void>;
  close(): void | Promise<void>;

  countWorkflows(): Promise<number>;
  listWorkflows(): Promise<StoredWorkflow[]>;
  getWorkflow(id: string): Promise<StoredWorkflow | undefined>;
  upsertWorkflow(id: string, definition: WorkflowDefinition): Promise<StoredWorkflow>;
  deleteWorkflow(id: string): Promise<boolean>;

  addExecution(workflowId: string, result: RunResult, startedAt: string): Promise<StoredExecution>;
  getExecution(id: string): Promise<StoredExecution | undefined>;
  listExecutions(options?: ListExecutionsOptions): Promise<StoredExecution[]>;

  listCredentials(): Promise<CredentialMeta[]>;
  getCredential(id: string): Promise<CredentialRow | undefined>;
  addCredential(id: string, name: string, type: string, encryptedData: string): Promise<CredentialRow>;
  updateCredential(
    id: string,
    changes: { name?: string; type?: string; data?: string },
  ): Promise<CredentialRow | undefined>;
  deleteCredential(id: string): Promise<boolean>;
}
