/**
 * n8n-style expression resolution: `{{ ... }}` placeholders evaluated in a
 * small scope built around the current item.
 *
 * NOTE: `new Function` is NOT a security sandbox. Workflows must be trusted.
 * A real n8n uses a restricted expression parser for untrusted input; that is
 * deliberately out of scope for this engine-first MVP.
 */

import type { Item } from './types.js';

const PLACEHOLDER = /\{\{\s*([\s\S]+?)\s*\}\}/g;
const FULL_PLACEHOLDER = /^\{\{\s*([\s\S]+?)\s*\}\}$/;

export interface ExpressionScope {
  $json: Record<string, any>;
  $itemIndex: number;
  $now: Date;
  $env: NodeJS.ProcessEnv;
  $items: Record<string, any>[];
}

export function makeScope(item: Item, index: number, items: Item[]): ExpressionScope {
  return {
    $json: item.json,
    $itemIndex: index,
    $now: new Date(),
    $env: process.env,
    $items: items.map((i) => i.json),
  };
}

export function evaluateExpression(expression: string, scope: ExpressionScope): any {
  const fn = new Function(
    '$json',
    '$itemIndex',
    '$now',
    '$env',
    '$items',
    `"use strict"; return (${expression});`,
  );
  return fn(scope.$json, scope.$itemIndex, scope.$now, scope.$env, scope.$items);
}

export function resolveValue(value: unknown, scope: ExpressionScope): any {
  if (typeof value === 'string') {
    const full = FULL_PLACEHOLDER.exec(value.trim());
    if (full) {
      return evaluateExpression(full[1], scope);
    }
    return value.replace(PLACEHOLDER, (_match, expression: string) =>
      String(evaluateExpression(expression, scope)),
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) => resolveValue(entry, scope));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, resolveValue(entry, scope)]),
    );
  }
  return value;
}

/** Convenience for resolving a value against a single item. */
export function resolveForItem(value: unknown, item: Item, index = 0, items: Item[] = [item]): any {
  return resolveValue(value, makeScope(item, index, items));
}
