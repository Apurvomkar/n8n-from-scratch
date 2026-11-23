import type {
  Item,
  NodeRecord,
  RunResult,
  WorkflowDefinition,
  WorkflowNode,
} from './types.js';
import { requireNode, outputCount } from './nodes/index.js';
import { topoSort } from './workflow.js';

export type RunEventType =
  | 'workflow-start'
  | 'node-start'
  | 'node-complete'
  | 'node-skipped'
  | 'node-error'
  | 'workflow-complete';

export interface RunEvent {
  type: RunEventType;
  nodeId?: string;
  message: string;
}

export interface RunOptions {
  /** Seed items handed to trigger nodes (simulates webhook/manual payload). */
  initialItems?: Item[];
  onEvent?: (event: RunEvent) => void;
  /** Stop the whole run after the first failing node (default: true). */
  stopOnError?: boolean;
  /** Resolve a credential id into its decrypted data. */
  resolveCredential?: (id: string) => Record<string, any> | undefined;
}

interface Incoming {
  sourceId: string;
  outputIndex: number;
  inputIndex: number;
}

export class WorkflowEngine {
  async run(workflow: WorkflowDefinition, options: RunOptions = {}): Promise<RunResult> {
    const emit = (event: RunEvent) => options.onEvent?.(event);
    const order = topoSort(workflow);
    const nodes = new Map<string, WorkflowNode>(
      workflow.nodes.map((node) => [node.id, node]),
    );

    // Build a reverse index: for each node, which outputs feed which inputs.
    const incoming = new Map<string, Incoming[]>();
    for (const [sourceId, value] of Object.entries(workflow.connections ?? {})) {
      (value.main ?? []).forEach((connections, outputIndex) => {
        for (const connection of connections ?? []) {
          const list = incoming.get(connection.node) ?? [];
          list.push({
            sourceId,
            outputIndex,
            inputIndex: connection.index ?? 0,
          });
          incoming.set(connection.node, list);
        }
      });
    }

    const outputs = new Map<string, Item[][]>();
    const records: NodeRecord[] = [];
    const startedAt = Date.now();
    let failed = false;

    emit({
      type: 'workflow-start',
      message: `Starting workflow '${workflow.name}' (${order.length} nodes)`,
    });

    for (const nodeId of order) {
      if (failed && options.stopOnError !== false) break;

      const node = nodes.get(nodeId)!;
      const label = node.name ?? node.type;
      const definition = requireNode(node.type);

      if (node.disabled) {
        records.push(emptyRecord(nodeId, label, definition.inputs, outputCount(node), 'skipped'));
        emit({ type: 'node-skipped', nodeId, message: `${label}: skipped (disabled)` });
        outputs.set(nodeId, Array.from({ length: outputCount(node) }, () => []));
        continue;
      }

      // Gather inputs from upstream output ports.
      const inputs: Item[][] = Array.from({ length: definition.inputs }, () => []);
      for (const link of incoming.get(nodeId) ?? []) {
        const upstream = outputs.get(link.sourceId)?.[link.outputIndex] ?? [];
        if (inputs[link.inputIndex]) {
          inputs[link.inputIndex].push(...upstream);
        }
      }

      const hasInput = inputs.some((list) => list.length > 0);
      if (definition.inputs > 0 && !hasInput) {
        records.push(emptyRecord(nodeId, label, 0, outputCount(node), 'skipped'));
        outputs.set(nodeId, Array.from({ length: outputCount(node) }, () => []));
        emit({ type: 'node-skipped', nodeId, message: `${label}: skipped (no input items)` });
        continue;
      }

      const nodeStartedAt = Date.now();
      emit({ type: 'node-start', nodeId, message: `${label}: running` });

      try {
        const credentials: Record<string, Record<string, any>> = {};
        for (const [credentialType, credentialId] of Object.entries(node.credentials ?? {})) {
          const resolved = options.resolveCredential?.(String(credentialId));
          if (resolved) {
            credentials[credentialType] = resolved;
          }
        }

        const result = await definition.execute(inputs, {
          node,
          workflow,
          initialItems: options.initialItems ?? [],
          credentials,
          log: (message) => emit({ type: 'node-complete', nodeId, message: `  ${label}: ${message}` }),
        });
        const normalized = Array.from({ length: outputCount(node) }, (_, index) => result[index] ?? []);
        outputs.set(nodeId, normalized);
        records.push({
          nodeId,
          name: label,
          status: 'ok',
          inputs: inputs.reduce((total, list) => total + list.length, 0),
          outputs: normalized.map((list) => list.length),
          ms: Date.now() - nodeStartedAt,
        });
        emit({
          type: 'node-complete',
          nodeId,
          message: `${label}: ok (out: ${normalized.map((list) => list.length).join(', ')})`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed = true;
        outputs.set(nodeId, Array.from({ length: outputCount(node) }, () => []));
        records.push({
          nodeId,
          name: label,
          status: 'error',
          inputs: inputs.reduce((total, list) => total + list.length, 0),
          outputs: [],
          ms: Date.now() - nodeStartedAt,
          error: message,
        });
        emit({ type: 'node-error', nodeId, message: `${label}: ERROR — ${message}` });
      }
    }

    const success = !failed;
    emit({
      type: 'workflow-complete',
      message: `Workflow '${workflow.name}' ${success ? 'completed' : 'failed'} in ${Date.now() - startedAt}ms`,
    });

    return {
      workflow: workflow.name,
      success,
      records,
      outputs: Object.fromEntries(outputs),
      ms: Date.now() - startedAt,
    };
  }
}

function emptyRecord(
  nodeId: string,
  name: string,
  inputs: number,
  outputCountValue: number,
  status: 'skipped',
): NodeRecord {
  return {
    nodeId,
    name,
    status,
    inputs,
    outputs: Array.from({ length: outputCountValue }, () => 0),
    ms: 0,
  };
}
