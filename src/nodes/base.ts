import type { Item, WorkflowDefinition, WorkflowNode } from '../types.js';

export interface NodeExecuteContext {
  node: WorkflowNode;
  workflow: WorkflowDefinition;
  /** Seed items supplied to trigger nodes by the runner. */
  initialItems: Item[];
  /** Decrypted credentials, keyed by the credential type declared by the node. */
  credentials: Record<string, Record<string, any>>;
  log: (message: string) => void;
}

export interface INodeType {
  type: string;
  description: string;
  /** Number of `main` input ports. */
  inputs: number;
  /** Number of `main` output ports. */
  outputs: number;
  /** Optional dynamic port count (e.g. a Switch node configured with N outputs). */
  outputCount?: (node: WorkflowNode) => number;
  /** Trigger nodes need no input and start an execution. */
  trigger?: boolean;
  /** Credential types this node can use (e.g. 'slackApi'). */
  credentialTypes?: string[];
  /** Returns one item array per output port. */
  execute(inputs: Item[][], ctx: NodeExecuteContext): Promise<Item[][]> | Item[][];
}

export function emptyOutputs(count: number): Item[][] {
  return Array.from({ length: count }, () => []);
}
