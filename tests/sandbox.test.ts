import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WorkflowEngine } from '../src/engine.js';
import { runInSandbox } from '../src/sandbox.js';
import type { WorkflowDefinition } from '../src/types.js';

function codeWorkflow(jsCode: string, timeoutMs?: number): WorkflowDefinition {
  return {
    name: 'code test',
    nodes: [
      { id: 'trigger', type: 'manualTrigger', parameters: {} },
      {
        id: 'code',
        type: 'code',
        parameters: { jsCode, ...(timeoutMs ? { timeoutMs } : {}) },
      },
    ],
    connections: {
      trigger: { main: [[{ node: 'code', type: 'main', index: 0 }]] },
    },
  };
}

const seed = [{ json: { amount: 21 } }];

test('code node transforms items inside the sandbox', async () => {
  const result = await new WorkflowEngine().run(
    codeWorkflow('return items.map(item => ({ ...item, doubled: item.amount * 2 }));'),
    { initialItems: seed },
  );
  assert.equal(result.success, true);
  assert.equal(result.outputs.code[0][0].json.doubled, 42);
});

test('sandbox captures console output', async () => {
  const result = await runInSandbox(
    'console.log("hello", { n: 1 }); return 7;',
    {},
    500,
  );
  assert.equal(result.value, 7);
  assert.ok(result.logs.some((line) => line.includes('hello')));
});

test('sandbox hides process, require and fetch', async () => {
  const result = await runInSandbox(
    'return [typeof process, typeof require, typeof fetch];',
    {},
    500,
  );
  assert.deepEqual([...(result.value as unknown[])], ['undefined', 'undefined', 'undefined']);
});

test('sandbox blocks Function/eval constructor escape', async () => {
  const result = await new WorkflowEngine().run(
    codeWorkflow("return Function('return process')();"),
    { initialItems: seed },
  );
  assert.equal(result.success, false);
  assert.ok(
    result.records.some((record) => record.error?.toLowerCase().includes('code')),
  );
});

test('sandbox enforces a timeout on infinite loops', async () => {
  const result = await new WorkflowEngine().run(codeWorkflow('while (true) {}', 50), {
    initialItems: seed,
  });
  assert.equal(result.success, false);
  assert.ok(result.records.some((record) => /timed out|exceeded/i.test(record.error ?? '')));
});
