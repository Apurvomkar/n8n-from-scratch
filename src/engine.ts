/** Graph execution engine with support for loops (cycles) and branches. */

import type {
  Item,
  NodeRecord,
  RunResult,
  WorkflowDefinition,
  WorkflowNode,
} from './types.js';
import { requireNode, outputCount } from './nodes/index.js';
import {
  buildEdges,
  edgeKey,
  findBackEdges,
  hasSelfLoop,
  orderComponents,
  orderWithinComponent,
} from './graph.js';

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
  /** Resolve a credential id into its decrypted data (sync or async). */
  resolveCredential?: (
    id: string,
  ) => Record<string, any> | undefined | Promise<Record<string, any> | undefined>;
  /** Override the maximum iterations for loop components. */
  maxIterations?: number;
}

interface Incoming {
  sourceId: string;
  outputIndex: number;
  inputIndex: number;
}

export class WorkflowEngine {
  async run(workflow: WorkflowDefinition, options: RunOptions = {}): Promise<RunResult> {
    const emit = (event: RunEvent) => options.onEvent?.(event);
    const nodes = new Map<string, WorkflowNode>(
      workflow.nodes.map((node) => [node.id, node]),
    );
    const components = orderComponents(workflow);
    const maxIterations = Number(
      workflow.settings?.maxLoopIterations ?? options.maxIterations ?? 100,
    );

    // Cross-component deliveries, indexed by target input port.
    const delivered = new Map<string, Item[][]>();
    // Final outputs of nodes that have completed, indexed by output port.
    const outputs = new Map<string, Item[][]>();
    const records: NodeRecord[] = [];
    const startedAt = Date.now();
    let failed = false;

    const emptyInputs = (node: WorkflowNode): Item[][] =>
      Array.from({ length: requireNode(node.type).inputs }, () => [] as Item[]);
    const emptyOutputs = (node: WorkflowNode): Item[][] =>
      Array.from({ length: outputCount(node) }, () => [] as Item[]);

    const incoming = new Map<string, Incoming[]>();
    for (const edge of buildEdges(workflow)) {
      if (!nodes.has(edge.target)) continue;
      const list = incoming.get(edge.target) ?? [];
      list.push({
        sourceId: edge.source,
        outputIndex: edge.outputIndex,
        inputIndex: edge.inputIndex,
      });
      incoming.set(edge.target, list);
    }

    const emitSkipped = (node: WorkflowNode, reason: string, iteration?: number): Item[][] => {
      records.push({
        nodeId: node.id,
        name: node.name ?? node.type,
        status: 'skipped',
        inputs: 0,
        outputs: emptyOutputs(node).map(() => 0),
        ms: 0,
        ...(iteration !== undefined ? { iteration } : {}),
      });
      emit({ type: 'node-skipped', nodeId: node.id, message: `${node.name ?? node.type}: skipped (${reason})` });
      return emptyOutputs(node);
    };

    const executeNode = async (
      node: WorkflowNode,
      inputs: Item[][],
      iteration?: number,
    ): Promise<Item[][]> => {
      const label = node.name ?? node.type;
      const definition = requireNode(node.type);

      if (node.disabled) {
        return emitSkipped(node, 'disabled', iteration);
      }
      if (definition.inputs > 0 && !inputs.some((list) => list.length > 0)) {
        return emitSkipped(node, 'no input items', iteration);
      }

      const nodeStartedAt = Date.now();
      emit({ type: 'node-start', nodeId: node.id, message: `${label}: running` });

      try {
        const credentials: Record<string, Record<string, any>> = {};
        for (const [credentialType, credentialId] of Object.entries(node.credentials ?? {})) {
          const resolved = await options.resolveCredential?.(String(credentialId));
          if (resolved) credentials[credentialType] = resolved;
        }

        const result = await definition.execute(inputs, {
          node,
          workflow,
          initialItems: options.initialItems ?? [],
          credentials,
          log: (message) => emit({ type: 'node-complete', nodeId: node.id, message: `  ${label}: ${message}` }),
        });
        const normalized = emptyOutputs(node).map((_, index) => result[index] ?? []);
        records.push({
          nodeId: node.id,
          name: label,
          status: 'ok',
          inputs: inputs.reduce((total, list) => total + list.length, 0),
          outputs: normalized.map((list) => list.length),
          ms: Date.now() - nodeStartedAt,
          ...(iteration !== undefined ? { iteration } : {}),
        });
        emit({
          type: 'node-complete',
          nodeId: node.id,
          message: `${label}: ok (out: ${normalized.map((list) => list.length).join(', ')})`,
        });
        return normalized;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed = true;
        records.push({
          nodeId: node.id,
          name: label,
          status: 'error',
          inputs: inputs.reduce((total, list) => total + list.length, 0),
          outputs: [],
          ms: Date.now() - nodeStartedAt,
          ...(iteration !== undefined ? { iteration } : {}),
          error: message,
        });
        emit({ type: 'node-error', nodeId: node.id, message: `${label}: ERROR — ${message}` });
        return emptyOutputs(node);
      }
    };

    const deliver = (
      nodeId: string,
      result: Item[][],
      members?: Set<string>,
      backEdges?: Set<string>,
    ): boolean => {
      let internalFlow = false;
      (workflow.connections?.[nodeId]?.main ?? []).forEach((connections, outputIndex) => {
        for (const connection of connections ?? []) {
          const items = result[outputIndex] ?? [];
          if (members?.has(connection.node)) {
            const key = edgeKey({
              source: nodeId,
              outputIndex,
              target: connection.node,
              inputIndex: connection.index ?? 0,
            });
            if (items.length > 0 && (!backEdges || backEdges.has(key))) internalFlow = true;
            continue;
          }
          const target = nodes.get(connection.node);
          if (!target) continue;
          const list = delivered.get(connection.node) ?? emptyInputs(target);
          if (list[connection.index]) list[connection.index].push(...items);
          delivered.set(connection.node, list);
        }
      });
      return internalFlow;
    };

    emit({
      type: 'workflow-start',
      message: `Starting workflow '${workflow.name}' (${nodes.size} nodes, ${components.length} components)`,
    });

    for (const component of components) {
      if (failed && options.stopOnError !== false) break;
      const members = new Set(component);
      const isLoop = component.length > 1 || hasSelfLoop(component[0], workflow.connections ?? {});

      if (!isLoop) {
        const node = nodes.get(component[0])!;
        const inputs = (delivered.get(node.id) ?? emptyInputs(node)).map((list) => [...list]);
        const result = await executeNode(node, inputs);
        outputs.set(node.id, result);
        deliver(node.id, result);
        continue;
      }

      // Loop component: re-execute while items travel on back edges.
      const loopBackEdges = findBackEdges(workflow, component);
      const loopOrder = orderWithinComponent(workflow, component);
      let previous = new Map<string, Item[][]>();
      let internalFlow = true;
      let iteration = 0;

      while (internalFlow && iteration < maxIterations && !(failed && options.stopOnError !== false)) {
        internalFlow = false;
        const current = new Map<string, Item[][]>();

        for (const nodeId of loopOrder) {
          const node = nodes.get(nodeId)!;
          const inputs = emptyInputs(node);

          if (iteration === 0) {
            const external = delivered.get(nodeId);
            external?.forEach((list, index) => {
              if (inputs[index]) inputs[index].push(...list);
            });
          }
          for (const link of incoming.get(nodeId) ?? []) {
            if (!members.has(link.sourceId)) continue;
            // Forward edges inside the component use this iteration's output;
            // back edges use the previous iteration's output.
            const upstream =
              current.get(link.sourceId)?.[link.outputIndex] ??
              previous.get(link.sourceId)?.[link.outputIndex] ??
              [];
            if (inputs[link.inputIndex]) inputs[link.inputIndex].push(...upstream);
          }

          const result = await executeNode(node, inputs, iteration);
          current.set(nodeId, result);
          if (deliver(nodeId, result, members, loopBackEdges)) internalFlow = true;
        }

        previous = current;
        iteration += 1;
      }

      if (internalFlow && iteration >= maxIterations) {
        records.push({
          nodeId: component.join('→'),
          name: 'Loop',
          status: 'error',
          inputs: 0,
          outputs: [],
          ms: 0,
          error: `Loop exceeded ${maxIterations} iterations`,
        });
        emit({
          type: 'node-error',
          message: `Loop exceeded ${maxIterations} iterations`,
        });
        failed = true;
        break;
      }

      for (const nodeId of component) {
        outputs.set(nodeId, previous.get(nodeId) ?? emptyOutputs(nodes.get(nodeId)!));
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
