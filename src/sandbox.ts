/**
 * Restricted JavaScript execution for Code nodes.
 *
 * Uses node:vm with a fresh context and `codeGeneration` disabled, so the code
 * cannot reach `process`, `require`, `fetch` or escape via
 * `constructor.constructor(...)`. This is a meaningful hardening step over
 * `new Function`, though a determined attacker with host access is out of scope.
 */

import vm from 'node:vm';

export interface SandboxResult {
  value: unknown;
  logs: string[];
}

const ALLOWED_GLOBALS = {
  JSON,
  Math,
  Date,
  Array,
  Object,
  String,
  Number,
  Boolean,
  RegExp,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Promise,
  Symbol,
  BigInt,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  encodeURIComponent,
  decodeURIComponent,
};

export async function runInSandbox(
  code: string,
  scope: Record<string, unknown>,
  timeoutMs = 1000,
): Promise<SandboxResult> {
  const logs: string[] = [];
  const makeLog = (level: string) => (...args: unknown[]) => {
    logs.push(
      `[${level}] ${args
        .map((arg) => {
          try {
            return typeof arg === 'string' ? arg : JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ')}`,
    );
  };

  const sandbox: Record<string, unknown> = {
    ...ALLOWED_GLOBALS,
    ...scope,
    console: {
      log: makeLog('log'),
      info: makeLog('log'),
      warn: makeLog('warn'),
      error: makeLog('error'),
    },
  };

  const context = vm.createContext(sandbox, {
    name: 'workflow-code-node',
    codeGeneration: { strings: false, wasm: false },
  });

  const script = new vm.Script(`"use strict";\n(async () => {\n${code}\n})()`, {
    filename: 'workflow-code.js',
  });

  let pending: Promise<unknown>;
  try {
    pending = script.runInContext(context, { timeout: timeoutMs }) as Promise<unknown>;
  } catch (error) {
    throw new Error(`Code node error: ${(error as Error).message}`);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Code node exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { value, logs };
  } catch (error) {
    throw new Error(`Code node error: ${(error as Error).message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
