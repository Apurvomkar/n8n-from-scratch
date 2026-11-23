/** Real integration nodes backed by credentials. */

import { DatabaseSync } from 'node:sqlite';
import type { Item } from '../types.js';
import { makeScope, resolveValue } from '../expression.js';
import type { INodeType } from './base.js';

type SqlValue = string | number | bigint | null | Uint8Array;

export const slackNode: INodeType = {
  type: 'slack',
  description: 'Posts to a Slack channel via chat.postMessage; simulates when no credential is set.',
  inputs: 1,
  outputs: 1,
  credentialTypes: ['slackApi'],
  async execute(inputs, ctx) {
    const token = ctx.credentials.slackApi?.token;
    const channel = String(ctx.node.parameters.channel ?? '#general');
    const results: Item[] = [];

    for (const [index, item] of inputs[0].entries()) {
      const scope = makeScope(item, index, inputs[0]);
      const message = String(
        resolveValue(ctx.node.parameters.message ?? '{{ JSON.stringify($json) }}', scope),
      );

      if (token) {
        const response = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${String(token)}`,
          },
          body: JSON.stringify({ channel, text: message }),
        });
        const body = (await response.json()) as Record<string, any>;
        results.push({
          json: { ...item.json, ok: Boolean(body.ok), channel, message, slack: body },
        });
      } else {
        ctx.log(`[slack simulated] ${channel}: ${message}`);
        results.push({
          json: { ...item.json, ok: true, simulated: true, channel, message },
        });
      }
    }
    return [results];
  },
};

export const emailNode: INodeType = {
  type: 'email',
  description: 'Sends email through the Resend API; simulates when no credential is set.',
  inputs: 1,
  outputs: 1,
  credentialTypes: ['emailApi'],
  async execute(inputs, ctx) {
    const credential = ctx.credentials.emailApi;
    const results: Item[] = [];

    for (const [index, item] of inputs[0].entries()) {
      const scope = makeScope(item, index, inputs[0]);
      const to = String(resolveValue(ctx.node.parameters.to ?? '', scope));
      const subject = String(resolveValue(ctx.node.parameters.subject ?? '', scope));
      const body = String(resolveValue(ctx.node.parameters.body ?? '', scope));

      if (credential?.apiKey) {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${String(credential.apiKey)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: credential.from ?? 'n8n-from-scratch <onboarding@resend.dev>',
            to: [to],
            subject,
            text: body,
          }),
        });
        const responseBody = (await response.json()) as Record<string, any>;
        results.push({
          json: { ...item.json, delivered: response.ok, to, subject, email: responseBody },
        });
      } else {
        ctx.log(`[email simulated] to=${to} subject=${subject}`);
        results.push({
          json: { ...item.json, delivered: true, simulated: true, to, subject },
        });
      }
    }
    return [results];
  },
};

export const sqliteNode: INodeType = {
  type: 'sqlite',
  description: 'Runs a SQL query against the database in a "sqlite" credential.',
  inputs: 1,
  outputs: 1,
  credentialTypes: ['sqlite'],
  execute(inputs, ctx) {
    const databasePath = ctx.credentials.sqlite?.databasePath;
    if (!databasePath) {
      throw new Error('sqlite node requires a "sqlite" credential with databasePath');
    }
    const db = new DatabaseSync(String(databasePath));
    try {
      const results: Item[] = [];
      for (const [index, item] of inputs[0].entries()) {
        const scope = makeScope(item, index, inputs[0]);
        const query = String(resolveValue(ctx.node.parameters.query ?? 'SELECT 1', scope));
        const values = (resolveValue(ctx.node.parameters.params ?? [], scope) as unknown[]).map(
          (value) => (value === undefined ? null : (value as SqlValue)),
        );

        if (/^\s*(select|pragma|with)\b/i.test(query)) {
          const rows = db.prepare(query).all(...values) as unknown as Record<string, any>[];
          rows.forEach((row) => results.push({ json: row }));
        } else {
          const info = db.prepare(query).run(...values);
          results.push({
            json: {
              ...item.json,
              changes: Number(info.changes),
              lastInsertRowid: String(info.lastInsertRowid),
            },
          });
        }
      }
      return [results];
    } finally {
      db.close();
    }
  },
};
