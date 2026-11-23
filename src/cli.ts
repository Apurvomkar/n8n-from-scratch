import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkflowEngine } from './engine.js';
import { describeWorkflow, loadWorkflow, validateWorkflow } from './workflow.js';
import { listNodes } from './nodes/index.js';
import type { Item } from './types.js';

const USAGE = `Usage: npm run dev -- <command> [options]

Commands:
  nodes                     List registered node types
  list [--dir <path>]       List workflow JSON files
  validate <file>           Validate a workflow definition
  describe <file>           Print nodes and connections
  run <file> [options]      Execute a workflow

Run options:
  --input <json>   Seed items, e.g. '[{"json":{"amount":50}}]', or '@file.json'
  --dir <path>     Workflow directory (used by 'list')
  --quiet          Suppress per-node event logging
`;

function parseArgs(args: string[]): { flags: Map<string, string>; positionals: string[] } {
  const flags = new Map<string, string>();
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'quiet') {
        flags.set(key, 'true');
      } else {
        flags.set(key, args[++index] ?? '');
      }
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function printNodeTable(records: Awaited<ReturnType<WorkflowEngine['run']>>['records']): void {
  console.log('\nResults');
  console.log('  ' + 'NODE'.padEnd(22) + 'STATUS'.padEnd(10) + 'IN'.padStart(4) + 'OUT'.padStart(10) + 'MS'.padStart(7));
  console.log('  ' + '-'.repeat(53));
  for (const record of records) {
    const name = record.name.length > 20 ? `${record.name.slice(0, 19)}…` : record.name;
    console.log(
      '  ' +
        name.padEnd(22) +
        record.status.padEnd(10) +
        String(record.inputs).padStart(4) +
        record.outputs.join('/').padStart(10) +
        String(record.ms).padStart(7),
    );
    if (record.error) {
      console.log(`      error: ${record.error}`);
    }
  }
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { flags, positionals } = parseArgs(rest);

  if (!command || command === 'help') {
    console.log(USAGE);
    return 0;
  }

  if (command === 'nodes') {
    console.log('Registered node types:');
    for (const node of listNodes()) {
      const kind = node.trigger ? 'trigger' : 'action';
      console.log(
        `  ${node.type.padEnd(16)} ${kind.padEnd(8)} in=${node.inputs} out=${node.outputs} — ${node.description}`,
      );
    }
    return 0;
  }

  if (command === 'list') {
    const dir = flags.get('dir') ?? join(process.cwd(), 'workflows');
    try {
      const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
      console.log(files.length ? `Workflows in ${dir}:` : 'No workflows found.');
      files.forEach((file) => console.log(`  - ${join(dir, file)}`));
    } catch (error) {
      console.log(`Could not list '${dir}': ${(error as Error).message}`);
      return 1;
    }
    return 0;
  }

  if (command === 'validate' || command === 'describe') {
    const file = positionals[0];
    if (!file) {
      console.log(`Missing workflow file. Usage: npm run dev -- ${command} <file>`);
      return 1;
    }
    try {
      const workflow = loadWorkflow(file);
      if (command === 'validate') {
        const errors = validateWorkflow(workflow);
        if (errors.length === 0) {
          console.log(`VALID: ${workflow.name} (${workflow.nodes.length} nodes)`);
          return 0;
        }
        console.log(`INVALID: ${workflow.name}`);
        errors.forEach((error) => console.log(`  - ${error}`));
        return 1;
      }
      console.log(describeWorkflow(workflow));
      return 0;
    } catch (error) {
      console.log(`Failed: ${(error as Error).message}`);
      return 1;
    }
  }

  if (command === 'run') {
    const file = positionals[0];
    if (!file) {
      console.log('Missing workflow file. Usage: npm run dev -- run <file>');
      return 1;
    }
    try {
      const workflow = loadWorkflow(file);
      const errors = validateWorkflow(workflow);
      if (errors.length > 0) {
        console.log('Cannot run an invalid workflow:');
        errors.forEach((error) => console.log(`  - ${error}`));
        return 1;
      }

      let initialItems: Item[] = [];
      const input = flags.get('input');
      if (input) {
        try {
          // '@path.json' reads items from a file — avoids shell quote issues.
          const text = input.startsWith('@')
            ? readFileSync(input.slice(1), 'utf-8')
            : input;
          initialItems = JSON.parse(text) as Item[];
          if (!Array.isArray(initialItems)) {
            throw new Error('Expected a JSON array of items');
          }
        } catch (error) {
          console.log(`Invalid --input: ${(error as Error).message}`);
          return 1;
        }
      }

      const quiet = flags.has('quiet');
      const engine = new WorkflowEngine();
      const result = await engine.run(workflow, {
        initialItems,
        onEvent: quiet ? undefined : (event) => console.log(event.message),
      });
      printNodeTable(result.records);
      console.log(`\n${result.success ? 'SUCCESS' : 'FAILURE'} — ${result.ms}ms`);
      return result.success ? 0 : 1;
    } catch (error) {
      console.log(`Failed: ${(error as Error).message}`);
      return 1;
    }
  }

  console.log(`Unknown command '${command}'.`);
  console.log(USAGE);
  return 1;
}
