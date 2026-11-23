import { PgStore } from './pg-store.js';
import { Store } from './store.js';
import type { WorkflowStore } from './store-types.js';

/** Choose Postgres when DATABASE_URL is provided, otherwise local SQLite. */
export function createStore(options: {
  sqlitePath: string;
  postgresUrl?: string;
}): WorkflowStore {
  if (options.postgresUrl) {
    return new PgStore(options.postgresUrl);
  }
  return new Store(options.sqlitePath);
}
