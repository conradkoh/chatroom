import { mapAssignedTaskSnapshot } from '../../../infrastructure/mappers/map-assigned-task.js';
import {
  removeAssignedTaskSnapshot,
  upsertAssignedTaskSnapshot,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';

// fallow-ignore-next-line unused-export
export const TASK_MONITOR_CURSOR_DEBOUNCE_MS = 1000;
// fallow-ignore-next-line unused-export
export const ASSIGNED_TASK_CHANGE_PAGE_LIMIT = 50;
export type AssignedTaskChangeItem = {
  revision: number;
  op: 'upsert' | 'delete';
  taskId: string;
  role: string;
  snapshot?: Parameters<typeof mapAssignedTaskSnapshot>[0];
};
export type AssignedTaskChangePage = {
  items: AssignedTaskChangeItem[];
  highRevision: number | null;
  hasMore: boolean;
};
// fallow-ignore-next-line unused-export
export function applyAssignedTaskChangeItems(items: readonly AssignedTaskChangeItem[]): void {
  for (const item of items) {
    if (item.op === 'delete') removeAssignedTaskSnapshot(item.taskId, item.role);
    else if (item.snapshot) upsertAssignedTaskSnapshot(mapAssignedTaskSnapshot(item.snapshot));
  }
}
export function createAssignedTaskCursorSync(deps: {
  fetchPage: (afterRevision: number, limit: number) => Promise<AssignedTaskChangePage>;
  isStopped: () => boolean;
  debounceMs?: number;
  pageLimit?: number;
}) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let repeat = false;
  let stopped = false;
  // fallow-ignore-next-line complexity
  const drainNow = async (): Promise<void> => {
    if (inFlight) {
      repeat = true;
      return;
    }
    if (stopped || deps.isStopped()) return;
    inFlight = true;
    try {
      do {
        repeat = false;
        const page = await deps.fetchPage(last, deps.pageLimit ?? ASSIGNED_TASK_CHANGE_PAGE_LIMIT);
        if (page.items.length === 0) break;
        applyAssignedTaskChangeItems(page.items);
        if (page.highRevision != null) last = page.highRevision;
        if (!page.hasMore) break;
      } while (!stopped && !deps.isStopped());
    } catch (error) {
      console.warn('[TaskMonitor] assigned-task delta fetch failed', error);
    } finally {
      inFlight = false;
      if (repeat && !stopped) void drainNow();
    }
  };
  // fallow-ignore-next-line complexity
  return {
    setLastProcessedRevision: (revision: number) => {
      last = revision;
    },
    getLastProcessedRevision: () => last,
    // fallow-ignore-next-line complexity
    notifyCursor: (latest: number) => {
      if (stopped || deps.isStopped() || latest <= last) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void drainNow();
      }, deps.debounceMs ?? TASK_MONITOR_CURSOR_DEBOUNCE_MS);
    },
    drainNow,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
