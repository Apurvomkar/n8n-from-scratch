import type { Item } from '../types.js';
import { makeScope, resolveValue } from '../expression.js';
import { runInSandbox } from '../sandbox.js';
import { type INodeType } from './base.js';

export const setNode: INodeType = {
  type: 'set',
  description: 'Sets or overwrites fields on every item using expressions.',
  inputs: 1,
  outputs: 1,
  execute(inputs, ctx) {
    const values = ctx.node.parameters.values ?? {};
    const items = inputs[0].map((item, index, all) => ({
      ...item,
      json: {
        ...item.json,
        ...resolveValue(values, makeScope(item, index, all)),
      },
    }));
    return [items];
  },
};

export const codeNode: INodeType = {
  type: 'code',
  description:
    'Runs JavaScript in a restricted sandbox. `items`, `$json`, `$now` and console are available.',
  inputs: 1,
  outputs: 1,
  async execute(inputs, ctx) {
    const code = String(ctx.node.parameters.jsCode ?? 'return items;');
    const timeoutMs = Number(ctx.node.parameters.timeoutMs ?? 1000);
    const jsons = inputs[0].map((item) => item.json);

    const result = await runInSandbox(
      code,
      {
        items: jsons,
        $json: jsons[0] ?? {},
        $items: jsons,
        $now: new Date(),
      },
      timeoutMs,
    );
    result.logs.forEach((message) => ctx.log(message));

    const list: any[] = Array.isArray(result.value) ? result.value : [result.value];
    const items: Item[] = list
      .filter((entry) => entry !== null && entry !== undefined)
      .map((entry) =>
        entry && typeof entry === 'object' && 'json' in entry
          ? (entry as Item)
          : { json: entry as Record<string, any> },
      );
    return [items];
  },
};

export const noOpNode: INodeType = {
  type: 'noOp',
  description: 'Passes items through unchanged.',
  inputs: 1,
  outputs: 1,
  execute(inputs) {
    return [inputs[0].map((item) => ({ ...item }))];
  },
};
