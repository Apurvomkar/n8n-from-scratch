import type { Item, WorkflowNode } from '../types.js';
import { evaluateExpression, makeScope, resolveValue, type ExpressionScope } from '../expression.js';
import { emptyOutputs, type INodeType } from './base.js';

type Operator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'contains'
  | 'notContains'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'true'
  | 'false';

function compare(left: any, operator: Operator, right: any): boolean {
  switch (operator) {
    case 'equals':
      return left === right;
    case 'notEquals':
      return left !== right;
    case 'greaterThan':
      return left > right;
    case 'greaterThanOrEqual':
      return left >= right;
    case 'lessThan':
      return left < right;
    case 'lessThanOrEqual':
      return left <= right;
    case 'contains':
      return String(left ?? '').includes(String(right ?? ''));
    case 'notContains':
      return !String(left ?? '').includes(String(right ?? ''));
    case 'isEmpty':
      return left === null || left === undefined || left === '' || (Array.isArray(left) && left.length === 0);
    case 'isNotEmpty':
      return !(left === null || left === undefined || left === '' || (Array.isArray(left) && left.length === 0));
    case 'true':
      return left === true;
    case 'false':
      return left === false;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

function testConditions(
  params: Record<string, any>,
  item: Item,
  index: number,
  all: Item[],
): boolean {
  const scope = makeScope(item, index, all);
  if (typeof params.condition === 'string' && params.condition.trim()) {
    return Boolean(evaluateExpression(params.condition, scope));
  }

  const conditions: any[] = params.conditions ?? [];
  if (conditions.length === 0) {
    return true;
  }
  const combinator = String(params.combinator ?? 'and').toLowerCase();
  const results = conditions.map((condition) => {
    const left = resolveValue(condition.left, scope);
    const right = resolveValue(condition.right, scope);
    return compare(left, String(condition.operator) as Operator, right);
  });
  return combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

export const ifNode: INodeType = {
  type: 'if',
  description: 'Routes each item to the true (output 0) or false (output 1) branch.',
  inputs: 1,
  outputs: 2,
  execute(inputs, ctx) {
    const outputs = emptyOutputs(2);
    inputs[0].forEach((item, index, all) => {
      const target = testConditions(ctx.node.parameters, item, index, all) ? 0 : 1;
      outputs[target].push(item);
    });
    return outputs;
  },
};

function switchOutputCount(node: WorkflowNode): number {
  const rules: any[] = node.parameters.rules ?? [];
  const highest = rules.reduce((max, rule) => Math.max(max, Number(rule.output) || 0), 0);
  const fallback = Number(node.parameters.fallbackOutput) || 0;
  return Math.max(2, highest, fallback) + 1;
}

export const switchNode: INodeType = {
  type: 'switch',
  description: 'Routes each item to the first matching rule output, or a fallback.',
  inputs: 1,
  outputs: 2,
  outputCount: switchOutputCount,
  execute(inputs, ctx) {
    const rules: any[] = ctx.node.parameters.rules ?? [];
    const count = switchOutputCount(ctx.node);
    const outputs = emptyOutputs(count);
    const fallback = Number(ctx.node.parameters.fallbackOutput) || 0;

    inputs[0].forEach((item, index, all) => {
      const scope: ExpressionScope = makeScope(item, index, all);
      let matched = false;
      for (const rule of rules) {
        const expression = String(rule.condition ?? '');
        if (expression && Boolean(evaluateExpression(expression, scope))) {
          outputs[Number(rule.output) || 0].push(item);
          matched = true;
          break;
        }
      }
      if (!matched) {
        outputs[fallback].push(item);
      }
    });
    return outputs;
  },
};

export const mergeNode: INodeType = {
  type: 'merge',
  description: 'Combines items from two inputs (append or combine by index).',
  inputs: 2,
  outputs: 1,
  execute(inputs, ctx) {
    const mode = String(ctx.node.parameters.mode ?? 'append');
    const [a, b] = inputs;
    if (mode === 'combine') {
      const length = Math.max(a.length, b.length);
      const merged: Item[] = [];
      for (let i = 0; i < length; i += 1) {
        if (!a[i] && !b[i]) continue;
        merged.push({
          ...(a[i] ?? {}),
          json: { ...(a[i]?.json ?? {}), ...(b[i]?.json ?? {}) },
        });
      }
      return [merged];
    }
    return [[...a, ...b]];
  },
};
