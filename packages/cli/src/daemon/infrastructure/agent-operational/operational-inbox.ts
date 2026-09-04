// fallow-ignore-file code-duplication complexity unused-export
/**
 * Chatroom-scoped operational inbox primitives.
 *
 * Each inbox instance represents exactly one chatroom for one machine. The
 * reactive subscription contains only slim change signals for that chatroom.
 * Operational rows are hydrated imperatively after each signal page so the
 * daemon never subscribes to the complete machine projection.
 */

import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { MachineAgentOperationalRow } from './agent-operational-read-model.js';
import type { Doc, Id } from '../../../api.js';
import { api } from '../../../api.js';

const DEFAULT_SIGNAL_PAGE_LIMIT = 100;
const DEFAULT_OPERATIONAL_PAGE_LIMIT = 500;

export type OperationalStatusSignal = Pick<
  Doc<'chatroom_machineOperationalSignals'>,
  'chatroomId' | 'role' | 'revisionKey' | 'signalKey' | 'projectedAt' | 'removed'
>;

export interface OperationalSignalPage {
  readonly items: readonly OperationalStatusSignal[];
  readonly afterSignalKey: string;
  readonly highSignalKey: string;
}

export interface OperationalInboxUpdate {
  readonly chatroomId: string;
  readonly signals: readonly OperationalStatusSignal[];
  readonly rows: readonly MachineAgentOperationalRow[];
  readonly removed: readonly { chatroomId: string; role: string }[];
  readonly afterSignalKey: string;
  readonly throughSignalKey: string;
}

export interface OperationalInboxOptions {
  readonly client: ConvexClient;
  readonly sessionId: SessionId;
  readonly machineId: string;
  readonly chatroomId: string;
  /** Defaults to the time the iterator is created. */
  readonly serviceStartedAt?: number | undefined;
  /** Overrides the initial operational signal cursor. */
  readonly initialAfterSignalKey?: string | undefined;
  readonly signalPageLimit?: number | undefined;
  readonly operationalPageLimit?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export type OperationalInboxHandler = (update: OperationalInboxUpdate) => Promise<void>;

/** Builds the exclusive signal cursor immediately before all signals at a time. */
export function operationalSignalCursorAt(timestamp: number): string {
  return `${String(Math.max(0, Math.floor(timestamp))).padStart(16, '0')}:`;
}

function abortError(): Error {
  const error = new Error('Operational inbox stopped');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function waitForOperationalSignalPage(
  options: OperationalInboxOptions,
  afterSignalKey: string
): Promise<OperationalSignalPage> {
  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | undefined;
    let settled = false;

    const cleanup = (): void => {
      unsubscribe?.();
      unsubscribe = undefined;
      options.signal?.removeEventListener('abort', onAbort);
    };

    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = (): void => {
      settle(() => reject(abortError()));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      throwIfAborted(options.signal);
    } catch (error) {
      settle(() => reject(error));
      return;
    }

    unsubscribe = options.client.onUpdate(
      api.machines.subscribeMachineOperationalSignalsSince,
      {
        sessionId: options.sessionId,
        machineId: options.machineId,
        chatroomId: options.chatroomId as Id<'chatroom_rooms'>,
        afterKey: afterSignalKey,
        limit: options.signalPageLimit ?? DEFAULT_SIGNAL_PAGE_LIMIT,
      },
      (result: unknown) => {
        if (!result || typeof result !== 'object') return;
        const page = result as {
          items?: readonly OperationalStatusSignal[] | undefined;
          highKey?: string | null | undefined;
        };
        const items = page.items;
        const highKey = page.highKey;
        if (!items?.length || !highKey) return;
        settle(() =>
          resolve({
            items,
            afterSignalKey,
            highSignalKey: highKey,
          })
        );
      },
      (error: unknown) => {
        settle(() => reject(error));
      }
    );
  });
}

/** Advances the cursor only after the consumer resumes the iterator. */
export async function* createOperationalSignalIterator(
  options: OperationalInboxOptions
): AsyncGenerator<OperationalSignalPage, void, void> {
  let afterSignalKey =
    options.initialAfterSignalKey ??
    operationalSignalCursorAt(options.serviceStartedAt ?? Date.now());

  while (!options.signal?.aborted) {
    const page = await waitForOperationalSignalPage(options, afterSignalKey);
    yield page;
    afterSignalKey = page.highSignalKey;
  }
}

async function fetchRowsForSignalPage(
  options: OperationalInboxOptions,
  page: OperationalSignalPage
): Promise<{
  rows: readonly MachineAgentOperationalRow[];
  removed: readonly { chatroomId: string; role: string }[];
}> {
  const rows: MachineAgentOperationalRow[] = [];
  const removed: { chatroomId: string; role: string }[] = [];
  let afterSignalKey = page.afterSignalKey;
  while (true) {
    throwIfAborted(options.signal);
    const result = await options.client.query(
      api.machines.listOperationalStatusForMachineSignalRange,
      {
        sessionId: options.sessionId,
        machineId: options.machineId,
        chatroomId: options.chatroomId as Id<'chatroom_rooms'>,
        afterSignalKey,
        throughSignalKey: page.highSignalKey,
        limit: options.operationalPageLimit ?? DEFAULT_OPERATIONAL_PAGE_LIMIT,
      }
    );
    rows.push(...result.rows);
    removed.push(...result.removed);
    if (!result.hasMore || !result.nextSignalKey) break;
    afterSignalKey = result.nextSignalKey;
  }
  return { rows, removed };
}

export async function runOperationalInbox(
  options: OperationalInboxOptions,
  onUpdate: OperationalInboxHandler
): Promise<void> {
  for await (const page of createOperationalSignalIterator(options)) {
    const hydrated = await fetchRowsForSignalPage(options, page);
    await onUpdate({
      chatroomId: options.chatroomId,
      signals: page.items,
      rows: hydrated.rows,
      removed: hydrated.removed,
      afterSignalKey: page.afterSignalKey,
      throughSignalKey: page.highSignalKey,
    });
  }
}
