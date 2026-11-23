import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { WorkflowEngine } from '../src/engine.js';
import { loadWorkflow, validateWorkflow } from '../src/workflow.js';
import type { Item, WorkflowDefinition } from '../src/types.js';

function item(json: Record<string, any>): Item {
  return { json };
}

function connect(source: string, target: string, input = 0, output = 0) {
  return {
    [source]: { main: Array.from({ length: output + 1 }, (_, i) => (i === output ? [{ node: target, type: 'main' as const, index: input }] : [])) },
  };
}

test('set node evaluates {{ }} expressions across items', async () => {
  const workflow: WorkflowDefinition = {
    name: 'set test',
    nodes: [
      { id: 'trigger', type: 'manualTrigger', parameters: {} },
      {
        id: 'set',
        type: 'set',
        parameters: {
          values: {
            doubled: '{{ $json.amount * 2 }}',
            label: '{{ $json.name.toUpperCase() }}',
          },
        },
      },
    ],
    connections: { trigger: { main: [[{ node: 'set', type: 'main', index: 0 }]] } },
  };

  const result = await new WorkflowEngine().run(workflow, {
    initialItems: [item({ amount: 10, name: 'ada' })],
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.outputs.set[0][0].json, {
    amount: 10,
    name: 'ada',
    doubled: 20,
    label: 'ADA',
  });
});

test('if node routes items and unused branches are skipped', async () => {
  const workflow: WorkflowDefinition = {
    name: 'if test',
    nodes: [
      { id: 'trigger', type: 'manualTrigger', parameters: {} },
      {
        id: 'branch',
        type: 'if',
        parameters: { condition: '$json.amount >= 100' },
      },
      { id: 'big', type: 'log', parameters: { message: 'big' } },
      { id: 'small', type: 'log', parameters: { message: 'small' } },
    ],
    connections: {
      trigger: { main: [[{ node: 'branch', type: 'main', index: 0 }]] },
      branch: {
        main: [
          [{ node: 'big', type: 'main', index: 0 }],
          [{ node: 'small', type: 'main', index: 0 }],
        ],
      },
    },
  };

  const bigResult = await new WorkflowEngine().run(workflow, {
    initialItems: [item({ amount: 150 })],
  });
  assert.equal(bigResult.outputs.branch[0].length, 1);
  assert.equal(bigResult.outputs.branch[1].length, 0);
  assert.equal(
    bigResult.records.find((r) => r.nodeId === 'small')?.status,
    'skipped',
  );

  const smallResult = await new WorkflowEngine().run(workflow, {
    initialItems: [item({ amount: 5 })],
  });
  assert.equal(smallResult.outputs.branch[0].length, 0);
  assert.equal(smallResult.outputs.branch[1].length, 1);
  assert.equal(smallResult.records.find((r) => r.nodeId === 'big')?.status, 'skipped');
});

test('merge combines items from two branches', async () => {
  const workflow: WorkflowDefinition = {
    name: 'merge test',
    nodes: [
      { id: 'trigger', type: 'manualTrigger', parameters: {} },
      { id: 'branch', type: 'if', parameters: { condition: '$json.amount >= 100' } },
      { id: 'left', type: 'noOp', parameters: {} },
      { id: 'right', type: 'noOp', parameters: {} },
      { id: 'merge', type: 'merge', parameters: { mode: 'append' } },
    ],
    connections: {
      trigger: { main: [[{ node: 'branch', type: 'main', index: 0 }]] },
      branch: {
        main: [
          [{ node: 'left', type: 'main', index: 0 }],
          [{ node: 'right', type: 'main', index: 0 }],
        ],
      },
      left: { main: [[{ node: 'merge', type: 'main', index: 0 }]] },
      right: { main: [[{ node: 'merge', type: 'main', index: 1 }]] },
    },
  };

  const result = await new WorkflowEngine().run(workflow, {
    initialItems: [item({ amount: 150 }), item({ amount: 5 })],
  });

  assert.equal(result.success, true);
  assert.deepEqual(
    result.outputs.merge[0].map((i) => i.json.amount).sort((a, b) => a - b),
    [5, 150],
  );
});

test('validation detects cycles', () => {
  const workflow: WorkflowDefinition = {
    name: 'cycle test',
    nodes: [
      { id: 'a', type: 'set', parameters: { values: {} } },
      { id: 'b', type: 'set', parameters: { values: {} } },
    ],
    connections: {
      a: { main: [[{ node: 'b', type: 'main', index: 0 }]] },
      b: { main: [[{ node: 'a', type: 'main', index: 0 }]] },
    },
  };
  const errors = validateWorkflow(workflow);
  assert.ok(errors.some((error) => error.includes('Cycle')));
});

test('bundled webhook workflow runs end to end', async () => {
  const workflow = loadWorkflow(join(process.cwd(), 'workflows', 'webhook-to-slack.json'));
  const result = await new WorkflowEngine().run(workflow);

  assert.equal(result.success, true);
  assert.equal(result.outputs.buildMessage[0][0].json.channel, '#sales');
  assert.match(result.outputs.buildMessage[0][0].json.text, /Ada.*pro.*12 seats/);
  assert.equal(result.outputs.post[0].length, 1);
});

test('connect helper builds a single output connection', () => {
  assert.deepEqual(connect('a', 'b'), {
    a: { main: [[{ node: 'b', type: 'main', index: 0 }]] },
  });
});
