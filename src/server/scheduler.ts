/** Schedules workflows whose `settings.schedule` holds a cron expression. */

import cron, { type ScheduledTask } from 'node-cron';
import type { WorkflowStore } from './store-types.js';

export interface SchedulerOptions {
  store: WorkflowStore;
  runWorkflow: (id: string) => Promise<void>;
  log?: (message: string) => void;
}

export interface SyncResult {
  registered: string[];
  errors: string[];
}

export class Scheduler {
  private readonly store: WorkflowStore;
  private readonly runWorkflow: (id: string) => Promise<void>;
  private readonly log: (message: string) => void;
  private readonly tasks = new Map<string, ScheduledTask>();

  constructor(options: SchedulerOptions) {
    this.store = options.store;
    this.runWorkflow = options.runWorkflow;
    this.log = options.log ?? (() => {});
  }

  /** Stop every existing job and register jobs for all currently scheduled workflows. */
  async sync(): Promise<SyncResult> {
    this.stop();
    const registered: string[] = [];
    const errors: string[] = [];

    for (const stored of await this.store.listWorkflows()) {
      const expression = stored.definition.settings?.schedule;
      if (!expression) continue;

      const cronExpression = String(expression);
      if (!cron.validate(cronExpression)) {
        errors.push(`Workflow '${stored.name}' has invalid cron expression '${cronExpression}'`);
        continue;
      }

      const timezone = stored.definition.settings?.timezone;
      const task = cron.schedule(
        cronExpression,
        () => {
          this.log(`Scheduled run: ${stored.name} (${cronExpression})`);
          void this.runWorkflow(stored.id).catch((error: unknown) => {
            this.log(`Scheduled run failed: ${(error as Error).message}`);
          });
        },
        timezone ? { timezone: String(timezone) } : undefined,
      );

      this.tasks.set(stored.id, task);
      registered.push(stored.id);
    }

    return { registered, errors };
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
  }

  get size(): number {
    return this.tasks.size;
  }
}
