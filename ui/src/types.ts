export interface NodeDefinition {
  type: string;
  description: string;
  inputs: number;
  outputs: number;
  trigger: boolean;
  credentialTypes: string[];
}

export interface CredentialMeta {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowNodeDef {
  id: string;
  type: string;
  name?: string;
  position?: [number, number];
  parameters: Record<string, any>;
  credentials?: Record<string, string>;
}

export interface ConnectionDef {
  node: string;
  type: 'main';
  index: number;
}

export interface Connections {
  [sourceId: string]: { main: ConnectionDef[][] };
}

export interface WorkflowDefinition {
  name: string;
  nodes: WorkflowNodeDef[];
  connections: Connections;
  settings?: Record<string, any>;
}

export interface StoredWorkflow {
  id: string;
  definition: WorkflowDefinition;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  scheduled: boolean;
  nodes: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  nodeId: string;
  name: string;
  status: 'ok' | 'skipped' | 'error';
  inputs: number;
  outputs: number[];
  ms: number;
  iteration?: number;
  error?: string;
}

export interface RunResponse {
  success: boolean;
  executionId: string;
  records: RunRecord[];
  ms: number;
}

export interface Execution {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'success' | 'failure';
  startedAt: string;
  ms: number;
  records: RunRecord[];
  outputs: Record<string, unknown>;
  error?: string;
}
