# n8n from scratch (engine-first)

> Deployment: see [DEPLOY.md](DEPLOY.md) for hosting the API + editor on Render/Railway
> and pointing a Hostinger domain at it.

A from-scratch implementation of **n8n's core ideas**, built in TypeScript. This is
the engine layer first: no web UI yet. Workflows are JSON documents made of
**nodes** and **connections**, and data flows through them as **items**.

## What's implemented

- **n8n-style workflow JSON** — `nodes[]` with `id`, `type`, `parameters`, `position`,
  and `connections` mapping output ports to target nodes/inputs.
- **Graph execution engine** — topological dataflow with item passing, branch
  routing, merges, skipped branches, per-node timing, and validation.
- **Expression resolution** — `{{ ... }}` placeholders evaluated against
  `$json`, `$itemIndex`, `$now`, `$env`, and `$items` (n8n-style).
- **Node registry** — 11 built-in nodes, plus `registerNode()` for custom ones.
- **CLI** — `nodes`, `list`, `validate`, `describe`, `run`.
- **Tests** using Node's built-in test runner.

## Quick start

```powershell
cd "D:\Open Code\n8n-from-scratch"
npm install

npm run dev -- nodes
npm run dev -- list
npm run dev -- validate workflows/order-routing.json
npm run dev -- describe workflows/order-routing.json
npm run dev -- run workflows/order-routing.json
npm run dev -- run workflows/order-routing.json --input '@examples/low-value-order.json'
npm test
npm run typecheck
```

## Phase 2: HTTP API, persistence, webhooks & scheduling

Start the server (it auto-seeds the bundled workflows into SQLite on first run):

```powershell
npm run server
# Health: http://localhost:3000/health
# Config: PORT=4000 DB_PATH=path/to/workflows.db npm run server
```

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Status, workflow count, scheduled job count |
| `GET` | `/api/workflows` | List workflow summaries |
| `POST` | `/api/workflows` | Create a workflow (body = workflow JSON, optional `id`) |
| `GET` | `/api/workflows/:id` | Get a full workflow definition |
| `PUT` | `/api/workflows/:id` | Update a workflow |
| `DELETE` | `/api/workflows/:id` | Delete a workflow |
| `POST` | `/api/workflows/:id/run` | Run with `{ "items": [...] }` or a bare item array |
| `GET` | `/api/executions?workflowId=&limit=` | Execution history |
| `GET` | `/api/executions/:id` | Full execution record (records + outputs) |
| `GET` | `/api/credentials` | List credential metadata (never secrets) |
| `POST` | `/api/credentials` | Create a credential from `{ name, type, data }` |
| `PUT` | `/api/credentials/:id` | Update a credential |
| `DELETE` | `/api/credentials/:id` | Delete a credential |
| `POST` | `/webhook/:id` | Trigger a workflow; request body becomes one item |

### Webhook tokens and schedules

Set these in a workflow's `settings`:

```json
{
  "settings": {
    "schedule": "*/5 * * * *",
    "timezone": "UTC",
    "webhookToken": "secret123",
    "defaultItems": [{ "json": { "tick": true } }]
  }
}
```

- `schedule` is a standard cron expression (6 fields are supported for seconds).
  The scheduler re-syncs automatically when workflows are created, updated or deleted.
- `webhookToken`, when set, requires `?token=...` or an `x-webhook-token` header
  on `/webhook/:id`.
- `defaultItems` seeds trigger nodes when a run has no explicit items.

Example:

```powershell
curl.exe -X POST http://localhost:3000/webhook/order-routing `
  -H "Content-Type: application/json" `
  -d '{"orderId":"WH-1","amount":250,"tier":"gold"}'
```

Persistence uses Node's built-in `node:sqlite`, stored at `data/workflows.db`.

## Phase 4: credentials & integrations

Credentials are stored **encrypted at rest** with AES-256-GCM. The API only ever
returns metadata (`id`, `name`, `type`, timestamps) — secret data is decrypted in
memory at execution time and handed to the node that declares the matching
credential type.

The encryption key comes from `ENCRYPTION_KEY` (recommended in production), or a
local key generated at `data/.encryption-key` for development.

```powershell
# Create a credential via the UI's "Credentials" button, or via the API:
curl.exe -X POST http://localhost:3000/api/credentials `
  -H "Content-Type: application/json" `
  -d '{\"name\":\"Local DB\",\"type\":\"sqlite\",\"data\":{\"databasePath\":\"D:/path/to/workflows.db\"}}'
```

Then reference it in a node:

```json
{
  "id": "query",
  "type": "sqlite",
  "parameters": { "query": "SELECT name FROM workflows" },
  "credentials": { "sqlite": "<credential-id>" }
}
```

Supported credential types:

| Type | Used by | Data fields |
| --- | --- | --- |
| `sqlite` | `sqlite` | `databasePath` |
| `slackApi` | `slack` | `token` |
| `emailApi` | `email` | `apiKey`, `from` (Resend) |
| `httpBasicAuth` | `httpRequest` | `username`, `password` |
| `apiKey` | `httpRequest` | `name`, `value` |

`slack` and `email` call the real APIs when a credential is configured, and run
in a clearly-labelled **simulated** mode (console output) without one, so demos
work offline. `sqlite` always requires its credential.

## Built-in nodes

| Node | Type | In / Out | Purpose |
| --- | --- | --- | --- |
| Manual Trigger | `manualTrigger` | 0 / 1 | Starts a run; emits `--input` items |
| Webhook | `webhook` | 0 / 1 | Emits `parameters.payload` as an item |
| Set | `set` | 1 / 1 | Adds/overwrites fields via expressions |
| Code | `code` | 1 / 1 | Runs JavaScript with `items` / `$json` / `console` |
| IF | `if` | 1 / 2 | Routes items to true / false outputs |
| Switch | `switch` | 1 / N | Routes items by matching rules |
| Merge | `merge` | 2 / 1 | Appends or combines items from two inputs |
| HTTP Request | `httpRequest` | 1 / 1 | Fetches a URL per item (global `fetch`) |
| Delay | `delay` | 1 / 1 | Waits `amountMs` milliseconds |
| Log | `log` | 1 / 1 | Prints a message per item |
| No-op | `noOp` | 1 / 1 | Passes items through |
| Slack | `slack` | 1 / 1 | Posts to Slack, or simulates without credentials |
| Email | `email` | 1 / 1 | Sends via Resend, or simulates without credentials |
| SQLite | `sqlite` | 1 / 1 | Runs SQL using a `sqlite` credential |

## Workflow example

```json
{
  "name": "Order Routing",
  "nodes": [
    { "id": "trigger", "type": "manualTrigger", "parameters": {} },
    {
      "id": "set",
      "type": "set",
      "parameters": { "values": { "total": "{{ $json.amount * 2 }}" } }
    },
    { "id": "check", "type": "if", "parameters": { "condition": "$json.total > 100" } },
    { "id": "yes", "type": "log", "parameters": { "message": "Big: {{ $json.total }}" } },
    { "id": "no", "type": "log", "parameters": { "message": "Small: {{ $json.total }}" } }
  ],
  "connections": {
    "trigger": { "main": [[{ "node": "set", "type": "main", "index": 0 }]] },
    "set": { "main": [[{ "node": "check", "type": "main", "index": 0 }]] },
    "check": {
      "main": [
        [{ "node": "yes", "type": "main", "index": 0 }],
        [{ "node": "no", "type": "main", "index": 0 }]
      ]
    }
  }
}
```

Each IF output is a separate array of connections. Items that take the false
branch leave the true branch empty, so downstream nodes there are skipped.

## Project layout

```
n8n-from-scratch/
├── src/
│   ├── index.ts        # entry point
│   ├── cli.ts          # command-line interface
│   ├── types.ts        # Item, WorkflowNode, Connections, RunResult...
│   ├── expression.ts   # {{ ... }} resolution
│   ├── workflow.ts     # load / validate / describe / topoSort
│   ├── engine.ts       # graph execution engine
│   ├── nodes/
│   │   ├── base.ts     # INodeType interface
│   │   ├── index.ts    # registry
│   │   └── triggers.ts, data.ts, logic.ts, actions.ts, flow.ts, integrations.ts
│   └── server/
│       ├── index.ts    # server entry point + seeding
│       ├── app.ts      # Express routes
│       ├── store.ts    # SQLite persistence
│       ├── crypto.ts   # AES-256-GCM credential encryption
│       └── scheduler.ts# cron scheduling
├── workflows/          # seed workflow definitions
│   ├── order-routing.json
│   └── webhook-to-slack.json
├── examples/           # sample --input and API payloads
├── tests/              # engine + server tests
├── data/               # SQLite database (gitignored)
├── package.json
└── tsconfig.json
```

## Custom nodes

```ts
import { registerNode } from './src/nodes/index.js';

registerNode({
  type: 'myNode',
  description: 'Does something',
  inputs: 1,
  outputs: 1,
  execute(items) {
    return [items.map((item) => ({ json: { ...item.json, touched: true } }))];
  },
});
```

## Loops

Cycles are supported. The engine detects strongly connected components, orders
them topologically, and re-executes a loop component while items travel on its
**back edges** (DFS edges that point to an already-discovered node). Forward
edges inside the loop pass data within the same iteration.

A classic loop: an IF node sends one output back to an earlier node and the
other output forward. When the back edge stops carrying items, the loop ends.
See `workflows/counter-loop.json`:

```
trigger → increment → check ──true──▶ increment (back edge)
                          └──false──▶ done
```

Set `settings.maxLoopIterations` (default 100) to guard against infinite loops.
Exceeding it fails the run with a clear error. Execution records include the
`iteration` index, shown as an `Iter` column in the editor's results table.

## Code node sandbox

Code nodes run in a restricted `node:vm` context (`src/sandbox.ts`):

- No `process`, `require`, `fetch` or other host globals
- `codeGeneration: { strings: false }` blocks `eval` and `Function(...)` escapes
- A fresh context per execution, so prototype changes cannot leak between nodes
- `console.log/warn/error` output is forwarded into the execution log
- `timeoutMs` (default 1000) kills infinite synchronous loops and hangs

Available in scope: `items`, `$json`, `$items`, `$now`, `console`, and standard
JS built-ins. Code must `return` an array of items (or plain objects, which are
wrapped as `{ json: ... }`).

## Known limitations

- **Expression interpolation still uses `new Function`** — the Code node is
  sandboxed, but `{{ ... }}` interpolation in other nodes is not. Workflows
  must still be trusted.
- **Error handling stops the run** — partial failures per branch aren't retained.
- **Free-tier hosting has ephemeral storage** — see `DEPLOY.md`; the SQLite
  database resets on redeploy.

## Roadmap

1. ~~Phase 1 — graph engine, node registry, expressions, CLI.~~ **Done**
2. ~~Phase 2 — Express API, SQLite persistence, webhook endpoint, cron scheduler.~~ **Done**
3. ~~Phase 3 — React Flow visual editor with node palette, wiring and live logs.~~ **Done**
4. ~~Phase 4 — Credentials, integrations, editor credential picker.~~ **Done**
5. ~~Phase 5 — Loops/cycles with iteration limits.~~ **Done**
6. ~~Phase 6 — Sandboxed Code node with restricted `node:vm` context.~~ **Done**
7. **Next** — Postgres persistence for hosted deployments, editor polish (undo/redo, import/export).
