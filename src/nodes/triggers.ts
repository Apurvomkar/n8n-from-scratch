import type { Item } from '../types.js';
import { emptyOutputs, type INodeType } from './base.js';

export const manualTriggerNode: INodeType = {
  type: 'manualTrigger',
  description: 'Starts a workflow manually; emits the seed items from the runner.',
  inputs: 0,
  outputs: 1,
  trigger: true,
  execute(_inputs, ctx) {
    if (ctx.initialItems.length > 0) {
      return [ctx.initialItems];
    }
    const payload = ctx.node.parameters.payload;
    const items: Item[] = Array.isArray(payload)
      ? payload.map((entry) => ({ json: { ...entry } }))
      : [{ json: { ...(payload ?? {}) } }];
    return [items];
  },
};

export const webhookNode: INodeType = {
  type: 'webhook',
  description: 'Simulated webhook trigger. Emits parameters.payload as one item.',
  inputs: 0,
  outputs: 1,
  trigger: true,
  execute(_inputs, ctx) {
    if (ctx.initialItems.length > 0) {
      return [ctx.initialItems];
    }
    const payload = ctx.node.parameters.payload ?? {};
    const item: Item = { json: { ...payload } };
    return [item].length ? [[item]] : emptyOutputs(1);
  },
};
