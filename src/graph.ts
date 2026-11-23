/** Graph utilities: edges, strongly connected components, SCC ordering. */

import type { Connections, WorkflowDefinition } from './types.js';

export interface GraphEdge {
  source: string;
  outputIndex: number;
  target: string;
  inputIndex: number;
}

export function buildEdges(workflow: WorkflowDefinition): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const [source, value] of Object.entries(workflow.connections ?? {})) {
    (value.main ?? []).forEach((connections, outputIndex) => {
      for (const connection of connections ?? []) {
        edges.push({
          source,
          outputIndex,
          target: connection.node,
          inputIndex: connection.index ?? 0,
        });
      }
    });
  }
  return edges;
}

/** Tarjan's SCC algorithm. Returns components in reverse topological order. */
export function computeSccs(workflow: WorkflowDefinition): string[][] {
  const ids = workflow.nodes.map((node) => node.id);
  const adjacency = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const edge of buildEdges(workflow)) {
    if (adjacency.has(edge.source) && adjacency.has(edge.target)) {
      adjacency.get(edge.source)!.push(edge.target);
    }
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const strongConnect = (nodeId: string): void => {
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const target of adjacency.get(nodeId) ?? []) {
      if (!indices.has(target)) {
        strongConnect(target);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, indices.get(target)!));
      }
    }

    if (lowLinks.get(nodeId) === indices.get(nodeId)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== nodeId);
      components.push(component);
    }
  };

  for (const id of ids) {
    if (!indices.has(id)) strongConnect(id);
  }
  return components;
}

/** SCCs ordered so upstream components come first. */
export function orderComponents(workflow: WorkflowDefinition): string[][] {
  const components = computeSccs(workflow);
  const componentOf = new Map<string, number>();
  components.forEach((component, index) => {
    component.forEach((nodeId) => componentOf.set(nodeId, index));
  });

  const indegree = components.map(() => 0);
  const adjacency: number[][] = components.map(() => []);
  for (const edge of buildEdges(workflow)) {
    const from = componentOf.get(edge.source);
    const to = componentOf.get(edge.target);
    if (from === undefined || to === undefined || from === to) continue;
    adjacency[from].push(to);
    indegree[to] += 1;
  }

  const queue = indegree.map((degree, index) => (degree === 0 ? index : -1)).filter((i) => i >= 0);
  const order: string[][] = [];
  while (queue.length > 0) {
    const index = queue.shift()!;
    order.push(components[index]);
    for (const target of adjacency[index]) {
      indegree[target] -= 1;
      if (indegree[target] === 0) queue.push(target);
    }
  }

  // Condensation graphs are DAGs; this is only a defensive fallback.
  if (order.length < components.length) {
    const ordered = new Set(order.flat());
    for (const component of components) {
      if (!component.every((nodeId) => ordered.has(nodeId))) order.push(component);
    }
  }
  return order;
}

export function hasSelfLoop(nodeId: string, connections: Connections): boolean {
  return (connections[nodeId]?.main ?? []).some((connections) =>
    (connections ?? []).some((connection) => connection.node === nodeId),
  );
}

export function edgeKey(edge: GraphEdge): string {
  return `${edge.source}:${edge.outputIndex}:${edge.target}:${edge.inputIndex}`;
}

/**
 * Edges that point "backwards" inside a strongly connected component. Only
 * these keep a loop alive — forward edges inside the component (for example
 * increment -> check) are ordinary data flow.
 */
export function findBackEdges(workflow: WorkflowDefinition, component: string[]): Set<string> {
  const members = new Set(component);
  const adjacency = new Map<string, GraphEdge[]>();
  for (const edge of buildEdges(workflow)) {
    if (!members.has(edge.source) || !members.has(edge.target)) continue;
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge);
    adjacency.set(edge.source, list);
  }

  // Start from entry nodes (those fed from outside the loop) so the loop head
  // is discovered first and its incoming edges are recognised as back edges.
  const entryNodes = new Set<string>();
  for (const edge of buildEdges(workflow)) {
    if (members.has(edge.target) && !members.has(edge.source)) {
      entryNodes.add(edge.target);
    }
  }
  const roots = [
    ...component.filter((nodeId) => entryNodes.has(nodeId)),
    ...component.filter((nodeId) => !entryNodes.has(nodeId)),
  ];

  const discovery = new Map<string, number>();
  let counter = 0;
  const visit = (nodeId: string): void => {
    if (discovery.has(nodeId)) return;
    discovery.set(nodeId, counter);
    counter += 1;
    for (const edge of adjacency.get(nodeId) ?? []) visit(edge.target);
  };
  for (const nodeId of roots) visit(nodeId);

  const backEdges = new Set<string>();
  for (const edge of buildEdges(workflow)) {
    if (!members.has(edge.source) || !members.has(edge.target)) continue;
    const from = discovery.get(edge.source);
    const to = discovery.get(edge.target);
    if (from !== undefined && to !== undefined && to <= from) {
      backEdges.add(edgeKey(edge));
    }
  }
  return backEdges;
}

/** Order nodes inside a loop component by their forward edges. */
export function orderWithinComponent(workflow: WorkflowDefinition, component: string[]): string[] {
  const backEdges = findBackEdges(workflow, component);
  const members = new Set(component);
  const adjacency = new Map<string, string[]>(component.map((id) => [id, []]));
  const indegree = new Map<string, number>(component.map((id) => [id, 0]));

  for (const edge of buildEdges(workflow)) {
    if (!members.has(edge.source) || !members.has(edge.target)) continue;
    if (backEdges.has(edgeKey(edge))) continue;
    adjacency.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
  }

  const queue = component.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const target of adjacency.get(id) ?? []) {
      const remaining = indegree.get(target)! - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  for (const id of component) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}
