/** Core data structures, modelled closely on n8n's workflow JSON format. */

export interface Item {
  json: Record<string, any>;
  binary?: Record<string, { data: string; mimeType?: string; fileName?: string }>;
}

export interface WorkflowNode {
  id: string;
  type: string;
  name?: string;
  position?: [number, number];
  parameters: Record<string, any>;
  credentials?: Record<string, string>;
  disabled?: boolean;
}

export interface NodeConnection {
  node: string;
  type: 'main';
  index: number;
}

export interface Connections {
  [sourceNodeId: string]: {
    main: NodeConnection[][];
  };
}

export interface WorkflowDefinition {
  name: string;
  nodes: WorkflowNode[];
  connections: Connections;
  settings?: Record<string, any>;
}

export type NodeStatus = 'ok' | 'skipped' | 'error';

export interface NodeRecord {
  nodeId: string;
  name: string;
  status: NodeStatus;
  inputs: number;
  outputs: number[];
  ms: number;
  iteration?: number;
  error?: string;
}

export interface RunResult {
  workflow: string;
  success: boolean;
  records: NodeRecord[];
  outputs: Record<string, Item[][]>;
  ms: number;
}
