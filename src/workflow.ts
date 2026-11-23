import { readFileSync } from 'node:fs';
import type { WorkflowDefinition, WorkflowNode } from './types.js';
import { getNode, outputCount, requireNode } from './nodes/index.js';

export function loadWorkflow(path: string): WorkflowDefinition {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    throw new Error(`Could not read workflow file '${path}': ${(error as Error).message}`);
  }
  try {
    return JSON.parse(raw) as WorkflowDefinition;
  } catch (error) {
    throw new Error(`Invalid JSON in '${path}': ${(error as Error).message}`);
  }
}

export function topoSort(workflow: WorkflowDefinition): string[] {
  const ids = workflow.nodes.map((node) => node.id);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));

  for (const [source, value] of Object.entries(workflow.connections ?? {})) {
    if (!indegree.has(source)) continue;
    for (const outputs of value.main ?? []) {
      for (const connection of outputs ?? []) {
        if (!indegree.has(connection.node)) continue;
        adjacency.get(source)!.push(connection.node);
        indegree.set(connection.node, (indegree.get(connection.node) ?? 0) + 1);
      }
    }
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const target of adjacency.get(id) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }

  if (order.length !== ids.length) {
    const stuck = ids.filter((id) => !order.includes(id));
    throw new Error(
      `Cycle detected involving: ${stuck.join(', ')}. Loops are not supported in this MVP.`,
    );
  }
  return order;
}

export function validateWorkflow(workflow: WorkflowDefinition): string[] {
  const errors: string[] = [];

  if (!workflow.name) {
    errors.push('Workflow must have a name');
  }
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    errors.push('Workflow must contain at least one node');
    return errors;
  }

  const byId = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes) {
    if (!node.id) {
      errors.push('A node is missing its id');
      continue;
    }
    if (byId.has(node.id)) {
      errors.push(`Duplicate node id '${node.id}'`);
      continue;
    }
    byId.set(node.id, node);

    if (!node.type) {
      errors.push(`Node '${node.id}' is missing its type`);
      continue;
    }
    const definition = getNode(node.type);
    if (!definition) {
      errors.push(`Unknown node type '${node.type}' on node '${node.id}'`);
    } else if (node.credentials) {
      const supported = definition.credentialTypes ?? [];
      for (const credentialType of Object.keys(node.credentials)) {
        if (!supported.includes(credentialType)) {
          errors.push(
            `Node '${node.id}' cannot use credential type '${credentialType}' (supports: ${supported.join(', ') || 'none'})`,
          );
        }
      }
    }
  }

  for (const [sourceId, value] of Object.entries(workflow.connections ?? {})) {
    const source = byId.get(sourceId);
    if (!source) {
      errors.push(`Connection source '${sourceId}' does not exist`);
      continue;
    }
    const outputCountValue = source.type && getNode(source.type) ? outputCount(source) : 0;
    (value.main ?? []).forEach((outputs, outputIndex) => {
      if (outputIndex >= outputCountValue) {
        errors.push(
          `Node '${sourceId}' has no output ${outputIndex} (it has ${outputCountValue})`,
        );
      }
      for (const connection of outputs ?? []) {
        if (connection.type && connection.type !== 'main') {
          errors.push(`Connection from '${sourceId}' uses unsupported type '${connection.type}'`);
        }
        const target = byId.get(connection.node);
        if (!target) {
          errors.push(`Connection target '${connection.node}' does not exist`);
          continue;
        }
        const targetDef = target.type ? getNode(target.type) : undefined;
        if (targetDef && (connection.index ?? 0) >= targetDef.inputs) {
          errors.push(
            `Node '${connection.node}' has no input ${connection.index ?? 0} (it has ${targetDef.inputs})`,
          );
        }
      }
    });
  }

  if (!workflow.nodes.some((node) => getNode(node.type)?.trigger)) {
    errors.push('Workflow needs at least one trigger node');
  }

  try {
    topoSort(workflow);
  } catch (error) {
    errors.push((error as Error).message);
  }

  return errors;
}

export function describeWorkflow(workflow: WorkflowDefinition): string {
  const lines: string[] = [`${workflow.name} — ${workflow.nodes.length} nodes`];
  for (const node of workflow.nodes) {
    const def = node.type ? getNode(node.type) : undefined;
    const inputs = def?.inputs ?? 0;
    const outputs = def ? (def.outputCount ? def.outputCount(node) : def.outputs) : 0;
    lines.push(
      `  ${node.id.padEnd(18)} ${node.type.padEnd(16)} in=${inputs} out=${outputs} ${node.name ? `(${node.name})` : ''}`,
    );
  }
  lines.push('Connections:');
  for (const [source, value] of Object.entries(workflow.connections ?? {})) {
    (value.main ?? []).forEach((outputs, outputIndex) => {
      for (const connection of outputs ?? []) {
        lines.push(`  ${source}[${outputIndex}] -> ${connection.node}[${connection.index ?? 0}]`);
      }
    });
  }
  return lines.join('\n');
}

export { requireNode };
