import { SqliteEventStore, getEventStorePath } from '../../infrastructure/event-store/index.js';
import type { StoredEvent } from '../../infrastructure/event-store/index.js';

export interface ListEventsOptions {
  machineId: string;
  chatroomId: string;
  limit?: number;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 200);
}

function printPage(page: StoredEvent[]): void {
  for (const event of page) {
    console.log(JSON.stringify(event));
  }
}

/**
 * Print events for a chatroom newest-first as JSON lines from the local SQLite
 * event store. Missing store (never run the daemon on this machine) prints
 * nothing and exits successfully. `storePath` is injectable for tests.
 */
export async function listEvents(options: ListEventsOptions, storePath?: string): Promise<void> {
  const store = new SqliteEventStore(storePath ?? getEventStorePath(options.machineId), {
    readOnly: true,
  });
  try {
    await paginateEvents(store, options);
  } finally {
    store.close();
  }
}

async function paginateEvents(store: SqliteEventStore, options: ListEventsOptions): Promise<void> {
  const limit = clampLimit(options.limit);
  let cursor: string | undefined;
  let remaining = limit;

  while (remaining > 0) {
    const page = store.listByChatroom({
      chatroomId: options.chatroomId,
      limit: Math.min(remaining, 200),
      cursor,
    });
    printPage(page.page);
    remaining -= page.page.length;
    if (page.isDone || !page.continueCursor) break;
    cursor = page.continueCursor;
  }
}
