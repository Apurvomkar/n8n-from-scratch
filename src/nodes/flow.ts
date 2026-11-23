import type { INodeType } from './base.js';

export const delayNode: INodeType = {
  type: 'delay',
  description: 'Pauses for a configured number of milliseconds, then passes items through.',
  inputs: 1,
  outputs: 1,
  async execute(inputs, ctx) {
    const ms = Number(ctx.node.parameters.amountMs ?? 0);
    if (ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
    return [inputs[0].map((item) => ({ ...item }))];
  },
};
