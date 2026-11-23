import type { Item } from '../types.js';
import { makeScope, resolveValue } from '../expression.js';
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
  description: 'Runs JavaScript over items. `items`, `$json` and console are available.',
  inputs: 1,
  outputs: 1,
  execute(inputs, ctx) {
    const code = String(ctx.node.parameters.jsCode ?? 'return items;');
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'items',
      '$json',
      '$now',
      'console',
      `"use strict";\n${code}`,
    ) as (items: Record<string, any>[], json: Record<string, any>, now: Date, c: Console) => any;

    const jsons = inputs[0].map((item) => item.json);
    const fakeConsole = {
      log: (...args: unknown[]) => ctx.log(args.map(String).join(' ')),
      warn: (...args: unknown[]) => ctx.log(args.map(String).join(' ')),
      error: (...args: unknown[]) => ctx.log(args.map(String).join(' ')),
    };
    const raw = fn(jsons, jsons[0] ?? {}, new Date(), fakeConsole as unknown as Console);

    const list: any[] = Array.isArray(raw) ? raw : [raw];
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
