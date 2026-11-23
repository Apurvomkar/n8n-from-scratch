import type { Edge, Node } from '@xyflow/react';
import type { NodeDefinition, WorkflowDefinition, WorkflowNodeDef } from './types';

export type EditorNodeData = {
  nodeType: string;
  name: string;
  parameters: Record<string, any>;
  inputs: number;
  outputs: number;
  trigger: boolean;
  credentials: Record<string, string>;
};

export type EditorNode = Node<EditorNodeData, 'workflow'>;

export function nodeData(
  nodeType: string,
  definitions: NodeDefinition[],
): EditorNodeData {
  const definition = definitions.find((entry) => entry.type === nodeType);
  const fallbackTrigger = nodeType === 'manualTrigger' || nodeType === 'webhook';
  return {
    nodeType,
    name: nodeType,
    parameters: defaultParameters(nodeType),
    inputs: definition?.inputs ?? (fallbackTrigger ? 0 : 1),
    outputs: definition?.outputs ?? 1,
    trigger: definition?.trigger ?? fallbackTrigger,
    credentials: {},
  };
}

export function defaultParameters(nodeType: string): Record<string, any> {
  switch (nodeType) {
    case 'manualTrigger':
      return { payload: {} };
    case 'webhook':
      return { payload: {} };
    case 'set':
      return { values: {} };
    case 'code':
      return { jsCode: 'return items;', timeoutMs: 1000 };
    case 'if':
      return { condition: '$json.amount > 0' };
    case 'switch':
      return { rules: [], fallbackOutput: 0 };
    case 'httpRequest':
      return { url: 'https://example.com', method: 'GET' };
    case 'delay':
      return { amountMs: 1000 };
    case 'log':
      return { message: '{{ JSON.stringify($json) }}' };
    case 'merge':
      return { mode: 'append' };
    default:
      return {};
  }
}

export function workflowToFlow(
  workflow: WorkflowDefinition,
  definitions: NodeDefinition[],
): { nodes: EditorNode[]; edges: Edge[] } {
  const nodes: EditorNode[] = workflow.nodes.map((node) => {
    const data = nodeData(node.type, definitions);
    return {
      id: node.id,
      type: 'workflow',
      position: { x: node.position?.[0] ?? 0, y: node.position?.[1] ?? 0 },
      data: {
        ...data,
        name: node.name ?? node.type,
        parameters: node.parameters ?? data.parameters,
        credentials: node.credentials ?? {},
      },
    };
  });

  const edges: Edge[] = [];
  for (const [source, value] of Object.entries(workflow.connections ?? {})) {
    (value.main ?? []).forEach((connections, outputIndex) => {
      for (const connection of connections ?? []) {
        edges.push({
          id: `e-${source}-${outputIndex}-${connection.node}-${connection.index}`,
          source,
          target: connection.node,
          sourceHandle: `out-${outputIndex}`,
          targetHandle: `in-${connection.index ?? 0}`,
          type: 'smoothstep',
        });
      }
    });
  }
  return { nodes, edges };
}

function handleIndex(handle: string | null | undefined): number {
  const match = /^(?:in|out)-(\d+)$/.exec(handle ?? '');
  return match ? Number(match[1]) : 0;
}

export function flowToWorkflow(
  name: string,
  nodes: EditorNode[],
  edges: Edge[],
  settings: Record<string, any>,
): WorkflowDefinition {
  const workflowNodes: WorkflowNodeDef[] = nodes.map((node) => ({
    id: node.id,
    type: node.data.nodeType,
    name: node.data.name,
    position: [Math.round(node.position.x), Math.round(node.position.y)],
    parameters: node.data.parameters,
    ...(Object.keys(node.data.credentials ?? {}).length > 0
      ? { credentials: node.data.credentials }
      : {}),
  }));

  const connections: WorkflowDefinition['connections'] = {};
  for (const edge of edges) {
    const outputIndex = handleIndex(edge.sourceHandle);
    const inputIndex = handleIndex(edge.targetHandle);
    const main = connections[edge.source]?.main ?? [];
    while (main.length <= outputIndex) main.push([]);
    main[outputIndex].push({ node: edge.target, type: 'main', index: inputIndex });
    connections[edge.source] = { main };
  }

  return {
    name,
    nodes: workflowNodes,
    connections,
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
  };
}
