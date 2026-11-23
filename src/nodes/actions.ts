import type { Item } from '../types.js';
import { makeScope, resolveValue } from '../expression.js';
import type { INodeType } from './base.js';

export const httpRequestNode: INodeType = {
  type: 'httpRequest',
  description: 'Calls an HTTP endpoint once per item and emits the response.',
  inputs: 1,
  outputs: 1,
  credentialTypes: ['httpBasicAuth', 'apiKey'],
  async execute(inputs, ctx) {
    const results: Item[] = [];
    for (const [index, item] of inputs[0].entries()) {
      const scope = makeScope(item, index, inputs[0]);
      const url = String(resolveValue(ctx.node.parameters.url, scope));
      const method = String(resolveValue(ctx.node.parameters.method ?? 'GET', scope)).toUpperCase();
      const headers: Record<string, string> = {
        ...(resolveValue(ctx.node.parameters.headers ?? {}, scope) as Record<string, string>),
      };

      const basic = ctx.credentials.httpBasicAuth;
      if (basic?.username && basic?.password) {
        headers.Authorization =
          'Basic ' + Buffer.from(`${basic.username}:${basic.password}`).toString('base64');
      }
      const apiKey = ctx.credentials.apiKey;
      if (apiKey?.name && apiKey?.value) {
        headers[String(apiKey.name)] = String(apiKey.value);
      }

      let body: string | undefined;
      if (ctx.node.parameters.sendBody && ctx.node.parameters.jsonBody !== undefined) {
        body = JSON.stringify(resolveValue(ctx.node.parameters.jsonBody, scope));
      }

      const response = await fetch(url, { method, headers, body });
      const text = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { text };
      }
      results.push({
        json: { ...item.json, statusCode: response.status, response: parsed },
      });
    }
    return [results];
  },
};

export const logNode: INodeType = {
  type: 'log',
  description: 'Prints a message per item and passes items through.',
  inputs: 1,
  outputs: 1,
  execute(inputs, ctx) {
    const template = String(ctx.node.parameters.message ?? '{{ JSON.stringify($json) }}');
    inputs[0].forEach((item, index, all) => {
      const message = String(resolveValue(template, makeScope(item, index, all)));
      ctx.log(message);
    });
    return [inputs[0].map((item) => ({ ...item }))];
  },
};
