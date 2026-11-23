import type { WorkflowNode } from '../types.js';
import type { INodeType } from './base.js';
import { manualTriggerNode, webhookNode } from './triggers.js';
import { setNode, codeNode, noOpNode } from './data.js';
import { ifNode, switchNode, mergeNode } from './logic.js';
import { httpRequestNode, logNode } from './actions.js';
import { delayNode } from './flow.js';
import { slackNode, emailNode, sqliteNode } from './integrations.js';

const registry = new Map<string, INodeType>();

export function registerNode(node: INodeType): void {
  registry.set(node.type, node);
}

export function getNode(type: string): INodeType | undefined {
  return registry.get(type);
}

export function requireNode(type: string): INodeType {
  const node = registry.get(type);
  if (!node) {
    throw new Error(
      `Unknown node type '${type}'. Available: ${[...registry.keys()].sort().join(', ')}`,
    );
  }
  return node;
}

export function listNodes(): INodeType[] {
  return [...registry.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export function outputCount(node: WorkflowNode): number {
  const def = requireNode(node.type);
  return def.outputCount ? def.outputCount(node) : def.outputs;
}

// Register built-in node types.
[
  manualTriggerNode,
  webhookNode,
  setNode,
  codeNode,
  noOpNode,
  ifNode,
  switchNode,
  mergeNode,
  httpRequestNode,
  logNode,
  delayNode,
  slackNode,
  emailNode,
  sqliteNode,
].forEach(registerNode);
