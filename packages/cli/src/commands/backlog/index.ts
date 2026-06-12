/**
 * Backlog commands for managing task queue and backlog.
 * Phase 12: Migrated to Effect-TS with typed errors and injected services.
 */

import { createHash } from 'node:crypto';
import * as nodePath from 'node:path';

import { Effect, Layer } from 'effect';

import {
  BacklogFsService,
  BacklogFsServiceFrom,
  BacklogFsServiceLive,
} from './backlog-fs-service.js';
import type { BacklogDeps, BacklogFsOps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  BackendServiceLive,
  SessionService,
  SessionServiceLive,
} from '../../infrastructure/services/index.js';
import { getErrorMessage } from '../../utils/convex-error.js';

// ─── Re-exports ────────────────────────────────────────────────────────────

// fallow-ignore-next-line unused-type
export type { BacklogDeps, BacklogFsOps } from './deps.js';
// fallow-ignore-next-line unused-export
export { BacklogFsService } from './backlog-fs-service.js';

// ─── Types ─────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'pending'
  | 'acknowledged'
  | 'in_progress'
  | 'pending_user_review'
  | 'completed'
  | 'closed';

type BacklogItemStatus = 'backlog' | 'pending_user_review' | 'closed';

export interface ListBacklogOptions {
  role: string;
  limit?: number;
  sort?: 'date:desc' | 'priority:desc';
  filter?: 'unscored';
}

export interface AddBacklogOptions {
  role: string;
  content: string;
}

export interface UpdateBacklogOptions {
  role: string;
  backlogItemId: string;
  content: string;
}

export interface CloseBacklogOptions {
  role: string;
  backlogItemId: string;
  reason: string;
}

export interface CompleteBacklogOptions {
  role: string;
  backlogItemId: string;
  force?: boolean;
}

export interface ReopenBacklogOptions {
  role: string;
  backlogItemId: string;
}

export interface PatchBacklogOptions {
  role: string;
  backlogItemId: string;
  complexity?: string;
  value?: string;
  priority?: string;
}

export interface ScoreBacklogOptions {
  role: string;
  backlogItemId: string;
  complexity?: string;
  value?: string;
  priority?: string;
}

export interface MarkForReviewBacklogOptions {
  role: string;
  backlogItemId: string;
}

export interface HistoryBacklogOptions {
  role: string;
  from?: string; // ISO date string e.g. "2026-03-01"
  to?: string; // ISO date string e.g. "2026-03-16"
  limit?: number;
}

export interface ExportBacklogOptions {
  role: string;
  path?: string;
}

export interface ImportBacklogOptions {
  role: string;
  path?: string;
}

/** Shape of a single item in the export JSON */
export interface BacklogExportItem {
  contentHash: string;
  content: string;
  status: string;
  createdBy: string;
  createdAt: number;
  complexity?: string;
  value?: string;
  priority?: number;
}

/** Shape of the export JSON file */
export interface BacklogExportFile {
  exportedAt: number;
  chatroomId: string;
  items: BacklogExportItem[];
}

/** Export file name constant */
const BACKLOG_EXPORT_FILENAME = 'backlog-export.json';

/** Staleness threshold: 7 days in milliseconds */
const STALENESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** Default export/import directory relative to cwd */
const DEFAULT_EXPORT_DIR = '.chatroom/exports';

// ─── Domain errors ─────────────────────────────────────────────────────────

export type BacklogError =
  | { readonly _tag: 'NotAuthenticated' }
  | { readonly _tag: 'BacklogItemNotFound'; readonly cause: Error }
  | { readonly _tag: 'InvalidInput'; readonly message: string }
  | { readonly _tag: 'MutationFailed'; readonly cause: Error; readonly context: string }
  | { readonly _tag: 'QueryFailed'; readonly cause: Error; readonly context: string }
  | { readonly _tag: 'ImportFailed'; readonly cause: Error };

// ─── Error Handler ─────────────────────────────────────────────────────────

function handleBacklogError(err: BacklogError): Effect.Effect<void> {
  return Effect.sync(() => {
    switch (err._tag) {
      case 'NotAuthenticated':
        console.error(`❌ Not authenticated. Please run: chatroom auth login`);
        break;
      case 'BacklogItemNotFound':
        console.error(`❌ Backlog item not found: ${getErrorMessage(err.cause)}`);
        break;
      case 'InvalidInput':
        console.error(`❌ ${err.message}`);
        break;
      case 'MutationFailed':
        console.error(`❌ ${err.context}: ${getErrorMessage(err.cause)}`);
        break;
      case 'QueryFailed':
        console.error(`❌ ${err.context}: ${getErrorMessage(err.cause)}`);
        break;
      case 'ImportFailed':
        console.error(`❌ Failed to import backlog items: ${getErrorMessage(err.cause)}`);
        break;
    }
    process.exit(1);
  });
}

// ─── Layer Builders ────────────────────────────────────────────────────────

function buildBaseLayer(d: BacklogDeps): Layer.Layer<BackendService | SessionService> {
  return Layer.mergeAll(
    BackendServiceLive({
      mutation: (e, a) => d.backend.mutation(e, a),
      query: (e, a) => d.backend.query(e, a),
    }),
    SessionServiceLive({
      getSessionId: d.session.getSessionId,
      getConvexUrl: d.session.getConvexUrl,
      getOtherSessionUrls: d.session.getOtherSessionUrls,
    })
  );
}

function buildFsLayer(fs: BacklogFsOps | undefined): Layer.Layer<BacklogFsService> {
  return fs ? BacklogFsServiceFrom(fs) : BacklogFsServiceLive;
}

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<BacklogDeps> {
  const client = await getConvexClient();
  const fs = await import('node:fs/promises');
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: {
      getSessionId,
      getConvexUrl,
      getOtherSessionUrls,
    },
    fs: {
      writeFile: (path, data) => fs.writeFile(path, data, 'utf-8'),
      readFile: (path, encoding) => fs.readFile(path, { encoding }),
      mkdir: (path, options) => fs.mkdir(path, options),
    },
  };
}

// ─── Auth / Validation Helpers (Effect versions) ───────────────────────────

function requireAuthEffect(
  sessionService: SessionService['Type']
): Effect.Effect<string, BacklogError> {
  return sessionService
    .getSessionId()
    .pipe(
      Effect.flatMap((id) =>
        id ? Effect.succeed(id as string) : Effect.fail<BacklogError>({ _tag: 'NotAuthenticated' })
      )
    );
}

function validateChatroomIdEffect(chatroomId: string): Effect.Effect<void, BacklogError> {
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    return Effect.fail<BacklogError>({
      _tag: 'InvalidInput',
      message: `Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`,
    });
  }
  return Effect.void;
}

// ─── Effect Programs ────────────────────────────────────────────────────────

// fallow-ignore-next-line unused-export complexity
export const listBacklogEffect = (
  chatroomId: string,
  options: ListBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    const limit = options.limit ?? 100;

    const backlogItems = yield* backend
      .query<Record<string, unknown>[]>(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        statusFilter: 'backlog',
        sort: options.sort,
        filter: options.filter,
        limit,
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'QueryFailed',
            cause,
            context: 'Failed to list backlog items',
          })
        )
      );

    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      console.log('');
      console.log('══════════════════════════════════════════════════');
      console.log('📋 BACKLOG');
      console.log('══════════════════════════════════════════════════');
      console.log(`Chatroom: ${chatroomId}`);
      console.log('');

      if (backlogItems.length === 0) {
        console.log('No backlog items.');
      } else {
        console.log('──────────────────────────────────────────────────');
        let itemIndex = 1;
        for (const item of backlogItems) {
          const statusEmoji = getStatusEmoji(item.status as BacklogItemStatus);
          const date = new Date(item.createdAt as number).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          console.log(
            `#${itemIndex} [${statusEmoji} ${String(item.status).toUpperCase()}] ${item.content}`
          );
          console.log(`   ID: ${item._id}`);
          console.log(
            `   Created: ${date}${item.assignedTo ? ` | Assigned: ${item.assignedTo}` : ''}`
          );
          if (
            item.complexity !== undefined ||
            item.value !== undefined ||
            item.priority !== undefined
          ) {
            const parts: string[] = [];
            if (item.complexity) parts.push(`complexity=${item.complexity}`);
            if (item.value) parts.push(`value=${item.value}`);
            if (item.priority !== undefined) parts.push(`priority=${item.priority}`);
            console.log(`   Score: ${parts.join(' | ')}`);
          }
          console.log('');
          itemIndex++;
        }
      }
      console.log('──────────────────────────────────────────────────');
      console.log(`Showing ${backlogItems.length} backlog item(s)`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export
export const addBacklogEffect = (
  chatroomId: string,
  options: AddBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.content || options.content.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item content cannot be empty',
      });
    }

    const itemId = yield* backend
      .mutation<string>(api.backlog.createBacklogItem, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        content: options.content.trim(),
        createdBy: options.role,
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'MutationFailed',
            cause,
            context: 'Failed to add backlog item',
          })
        )
      );

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item added');
      console.log(`   ID: ${itemId}`);
      console.log(`   Status: backlog`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export
export const completeBacklogEffect = (
  chatroomId: string,
  options: CompleteBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.backlogItemId || options.backlogItemId.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item ID is required',
      });
    }

    yield* backend
      .mutation<void>(api.backlog.completeBacklogItem, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        itemId: options.backlogItemId as Id<'chatroom_backlog'>,
      })
      .pipe(Effect.mapError((cause): BacklogError => ({ _tag: 'BacklogItemNotFound', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item completed');
      console.log(`   ID: ${options.backlogItemId}`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export
export const reopenBacklogEffect = (
  chatroomId: string,
  options: ReopenBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.backlogItemId || options.backlogItemId.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item ID is required',
      });
    }

    yield* backend
      .mutation<void>(api.backlog.reopenBacklogItem, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        itemId: options.backlogItemId as Id<'chatroom_backlog'>,
      })
      .pipe(Effect.mapError((cause): BacklogError => ({ _tag: 'BacklogItemNotFound', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item reopened');
      console.log(`   ID: ${options.backlogItemId}`);
      console.log(`   Status: backlog`);
      console.log('');
      console.log('💡 The backlog item is now ready for user review again.');
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export complexity
export const patchBacklogEffect = (
  chatroomId: string,
  options: PatchBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.backlogItemId || options.backlogItemId.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item ID is required',
      });
    }
    if (
      options.complexity === undefined &&
      options.value === undefined &&
      options.priority === undefined
    ) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'At least one of --complexity, --value, or --priority is required',
      });
    }

    const validComplexity = ['low', 'medium', 'high'];
    if (options.complexity !== undefined && !validComplexity.includes(options.complexity)) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: `Invalid complexity: ${options.complexity}. Must be one of: ${validComplexity.join(', ')}`,
      });
    }
    const validValue = ['low', 'medium', 'high'];
    if (options.value !== undefined && !validValue.includes(options.value)) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: `Invalid value: ${options.value}. Must be one of: ${validValue.join(', ')}`,
      });
    }

    let priorityNum: number | undefined;
    if (options.priority !== undefined) {
      priorityNum = parseInt(options.priority, 10);
      if (isNaN(priorityNum)) {
        return yield* Effect.fail<BacklogError>({
          _tag: 'InvalidInput',
          message: `Invalid priority: ${options.priority}. Must be a number.`,
        });
      }
    }

    yield* backend
      .mutation<void>(api.backlog.patchBacklogItem, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        itemId: options.backlogItemId as Id<'chatroom_backlog'>,
        complexity: options.complexity as 'low' | 'medium' | 'high' | undefined,
        value: options.value as 'low' | 'medium' | 'high' | undefined,
        priority: priorityNum,
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'MutationFailed',
            cause,
            context: 'Failed to patch backlog item',
          })
        )
      );

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item updated');
      console.log(`   ID: ${options.backlogItemId}`);
      if (options.complexity !== undefined) console.log(`   Complexity: ${options.complexity}`);
      if (options.value !== undefined) console.log(`   Value: ${options.value}`);
      if (priorityNum !== undefined) console.log(`   Priority: ${priorityNum}`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export complexity
export const scoreBacklogEffect = (
  chatroomId: string,
  options: ScoreBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.backlogItemId || options.backlogItemId.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item ID is required',
      });
    }
    if (
      options.complexity === undefined &&
      options.value === undefined &&
      options.priority === undefined
    ) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'At least one of --complexity, --value, or --priority is required',
      });
    }

    const validComplexity = ['low', 'medium', 'high'];
    if (options.complexity !== undefined && !validComplexity.includes(options.complexity)) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: `Invalid complexity: ${options.complexity}. Must be one of: ${validComplexity.join(', ')}`,
      });
    }
    const validValue = ['low', 'medium', 'high'];
    if (options.value !== undefined && !validValue.includes(options.value)) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: `Invalid value: ${options.value}. Must be one of: ${validValue.join(', ')}`,
      });
    }

    let priorityNum: number | undefined;
    if (options.priority !== undefined) {
      priorityNum = parseInt(options.priority, 10);
      if (isNaN(priorityNum)) {
        return yield* Effect.fail<BacklogError>({
          _tag: 'InvalidInput',
          message: `Invalid priority: ${options.priority}. Must be a number.`,
        });
      }
    }

    yield* backend
      .mutation<void>(api.backlog.patchBacklogItem, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        itemId: options.backlogItemId as Id<'chatroom_backlog'>,
        complexity: options.complexity as 'low' | 'medium' | 'high' | undefined,
        value: options.value as 'low' | 'medium' | 'high' | undefined,
        priority: priorityNum,
      })
      .pipe(Effect.mapError((cause): BacklogError => ({ _tag: 'BacklogItemNotFound', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item scored');
      console.log(`   ID: ${options.backlogItemId}`);
      if (options.complexity !== undefined) console.log(`   Complexity: ${options.complexity}`);
      if (options.value !== undefined) console.log(`   Value: ${options.value}`);
      if (priorityNum !== undefined) console.log(`   Priority: ${priorityNum}`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export
export const markForReviewBacklogEffect = (
  chatroomId: string,
  options: MarkForReviewBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.backlogItemId || options.backlogItemId.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item ID is required',
      });
    }

    yield* backend
      .mutation<void>(api.backlog.markBacklogItemForReview, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        itemId: options.backlogItemId as Id<'chatroom_backlog'>,
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'MutationFailed',
            cause,
            context: 'Failed to mark backlog item for review',
          })
        )
      );

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item marked for review');
      console.log(`   ID: ${options.backlogItemId}`);
      console.log(`   Status: pending_user_review`);
      console.log('');
      console.log(
        '💡 The backlog item is now visible in the "Pending Review" section for user confirmation.'
      );
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export complexity
export const historyBacklogEffect = (
  chatroomId: string,
  options: HistoryBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    const now = Date.now();
    const defaultFrom = now - 30 * 24 * 60 * 60 * 1000;

    let fromMs: number | undefined;
    let toMs: number | undefined;

    if (options.from) {
      const parsed = Date.parse(options.from);
      if (isNaN(parsed)) {
        return yield* Effect.fail<BacklogError>({
          _tag: 'InvalidInput',
          message: `Invalid --from date: "${options.from}". Use YYYY-MM-DD format.`,
        });
      }
      fromMs = parsed;
    }

    if (options.to) {
      const parsed = Date.parse(options.to);
      if (isNaN(parsed)) {
        return yield* Effect.fail<BacklogError>({
          _tag: 'InvalidInput',
          message: `Invalid --to date: "${options.to}". Use YYYY-MM-DD format.`,
        });
      }
      toMs = parsed + 86399999;
    }

    const tasks = yield* backend
      .query<Record<string, unknown>[]>(api.tasks.listHistoricalTasks, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        from: fromMs,
        to: toMs,
        limit: options.limit,
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'QueryFailed',
            cause,
            context: 'Failed to load history',
          })
        )
      );

    // fallow-ignore-next-line complexity
    yield* Effect.sync(() => {
      const fromDate = new Date(fromMs ?? defaultFrom).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const toDate = new Date(toMs ?? now).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      console.log('');
      console.log('══════════════════════════════════════════════════');
      console.log('📜 TASK HISTORY');
      console.log('══════════════════════════════════════════════════');
      console.log(`Chatroom: ${chatroomId}`);
      console.log(`Date range: ${fromDate} → ${toDate}`);
      console.log(`Filter: completed + closed`);
      console.log('');

      if (tasks.length === 0) {
        console.log('No history found for date range.');
      } else {
        console.log('──────────────────────────────────────────────────');
        console.log('📝 COMPLETED / CLOSED TASKS');
        console.log('──────────────────────────────────────────────────');

        let taskIndex = 1;
        for (const task of tasks) {
          const statusEmoji = getStatusEmoji(task.status as TaskStatus | BacklogItemStatus);
          const completedTs =
            (task as { completedAt?: number }).completedAt ?? (task.updatedAt as number);
          const date = new Date(completedTs).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
          console.log(
            `#${taskIndex} [${statusEmoji} ${String(task.status).toUpperCase()}] ${task.content}`
          );
          console.log(`   ID: ${task._id}`);
          console.log(
            `   Completed: ${date}${task.assignedTo ? ` | Assigned: ${task.assignedTo}` : ''}`
          );
          if (
            task.complexity !== undefined ||
            task.value !== undefined ||
            task.priority !== undefined
          ) {
            const parts: string[] = [];
            if (task.complexity) parts.push(`complexity=${task.complexity}`);
            if (task.value) parts.push(`value=${task.value}`);
            if (task.priority !== undefined) parts.push(`priority=${task.priority}`);
            console.log(`   Score: ${parts.join(' | ')}`);
          }
          console.log('');
          taskIndex++;
        }
      }
      console.log('──────────────────────────────────────────────────');
      console.log(`Showing ${tasks.length} task(s)`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export
export const updateBacklogEffect = (
  chatroomId: string,
  options: UpdateBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.backlogItemId || options.backlogItemId.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item ID is required',
      });
    }
    if (!options.content || options.content.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Content is empty. Provide content via --content-file or stdin.',
      });
    }

    yield* backend
      .mutation<void>(api.backlog.updateBacklogItem, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        itemId: options.backlogItemId as Id<'chatroom_backlog'>,
        content: options.content.trim(),
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'MutationFailed',
            cause,
            context: 'Failed to update backlog item',
          })
        )
      );

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item content updated');
      console.log(`   ID: ${options.backlogItemId}`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export
export const closeBacklogEffect = (
  chatroomId: string,
  options: CloseBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    if (!options.backlogItemId || options.backlogItemId.trim().length === 0) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Backlog item ID is required',
      });
    }
    const reason = options.reason.trim();
    if (!reason) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'InvalidInput',
        message: 'Reason is required when closing a backlog item',
      });
    }

    yield* backend
      .mutation<void>(api.backlog.closeBacklogItem, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        itemId: options.backlogItemId as Id<'chatroom_backlog'>,
        reason,
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'MutationFailed',
            cause,
            context: 'Failed to close backlog item',
          })
        )
      );

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Backlog item closed');
      console.log(`   ID: ${options.backlogItemId}`);
      console.log(`   Status: closed`);
      console.log(`   Reason: ${reason}`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export complexity
export const exportBacklogEffect = (
  chatroomId: string,
  options: ExportBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService | BacklogFsService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const fsService = yield* BacklogFsService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    const backlogItems = yield* backend
      .query<Record<string, unknown>[]>(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        statusFilter: 'backlog',
      })
      .pipe(
        Effect.mapError(
          (cause): BacklogError => ({
            _tag: 'QueryFailed',
            cause,
            context: 'Failed to export backlog items',
          })
        )
      );

    const exportData: BacklogExportFile = {
      exportedAt: Date.now(),
      chatroomId,
      items: backlogItems.map(
        (item: {
          content?: unknown;
          status?: unknown;
          createdBy?: unknown;
          createdAt?: unknown;
          complexity?: unknown;
          value?: unknown;
          priority?: unknown;
        }) => {
          const content = String(item.content ?? '');
          const exportItem: BacklogExportItem = {
            contentHash: computeContentHash(content),
            content,
            status: String(item.status ?? ''),
            createdBy: String(item.createdBy ?? 'unknown'),
            createdAt: Number(item.createdAt ?? 0),
          };
          if (item.complexity) exportItem.complexity = String(item.complexity);
          if (item.value) exportItem.value = String(item.value);
          if (item.priority !== undefined) exportItem.priority = Number(item.priority);
          return exportItem;
        }
      ),
    };

    const exportDir = options.path ?? nodePath.join(process.cwd(), DEFAULT_EXPORT_DIR);

    yield* fsService.mkdir(exportDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause): BacklogError => ({
          _tag: 'QueryFailed',
          cause,
          context: 'Failed to export backlog items',
        })
      )
    );

    const filePath = nodePath.join(exportDir, BACKLOG_EXPORT_FILENAME);

    yield* fsService.writeFile(filePath, JSON.stringify(exportData, null, 2)).pipe(
      Effect.mapError(
        (cause): BacklogError => ({
          _tag: 'QueryFailed',
          cause,
          context: 'Failed to export backlog items',
        })
      )
    );

    yield* Effect.sync(() => {
      console.log('');
      console.log(`✅ Exported ${exportData.items.length} backlog item(s)`);
      console.log(`   File: ${filePath}`);
      console.log('');
    });
  });

// fallow-ignore-next-line unused-export complexity
export const importBacklogEffect = (
  chatroomId: string,
  options: ImportBacklogOptions
): Effect.Effect<void, BacklogError, BackendService | SessionService | BacklogFsService> =>
  Effect.gen(function* () {
    const sessionService = yield* SessionService;
    const backend = yield* BackendService;
    const fsService = yield* BacklogFsService;
    const sessionId = yield* requireAuthEffect(sessionService);
    yield* validateChatroomIdEffect(chatroomId);

    const importDir = options.path ?? nodePath.join(process.cwd(), DEFAULT_EXPORT_DIR);
    const filePath = nodePath.join(importDir, BACKLOG_EXPORT_FILENAME);

    const raw = yield* fsService
      .readFile(filePath, 'utf-8')
      .pipe(Effect.mapError((cause): BacklogError => ({ _tag: 'ImportFailed', cause })));

    let exportData: BacklogExportFile;
    try {
      exportData = JSON.parse(raw) as BacklogExportFile;
    } catch (e) {
      return yield* Effect.fail<BacklogError>({
        _tag: 'ImportFailed',
        cause: e instanceof Error ? e : new Error(String(e)),
      });
    }

    const ageMs = Date.now() - exportData.exportedAt;
    if (ageMs > STALENESS_THRESHOLD_MS) {
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      yield* Effect.sync(() => {
        console.log(`⚠️  This export is ${ageDays} days old and may be stale.`);
      });
    }

    const existingItems = yield* backend
      .query<Record<string, unknown>[]>(api.backlog.listBacklogItems, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        statusFilter: 'backlog',
      })
      .pipe(Effect.mapError((cause): BacklogError => ({ _tag: 'ImportFailed', cause })));

    const existingHashes = new Set<string>(
      existingItems.map((item) => computeContentHash(String(item.content ?? '')))
    );

    let imported = 0;
    let skipped = 0;

    for (const item of exportData.items) {
      const hash = computeContentHash(item.content);
      if (existingHashes.has(hash)) {
        skipped++;
        continue;
      }

      yield* backend
        .mutation<void>(api.backlog.createBacklogItem, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          content: item.content,
          createdBy: item.createdBy,
          priority: item.priority,
          complexity: item.complexity as 'low' | 'medium' | 'high' | undefined,
          value: item.value as 'low' | 'medium' | 'high' | undefined,
        })
        .pipe(Effect.mapError((cause): BacklogError => ({ _tag: 'ImportFailed', cause })));

      existingHashes.add(hash);
      imported++;
    }

    yield* Effect.sync(() => {
      console.log('');
      console.log(`✅ Import complete`);
      console.log(`   Total items in file: ${exportData.items.length}`);
      console.log(`   Imported: ${imported}`);
      console.log(`   Skipped (duplicate): ${skipped}`);
      console.log('');
    });
  });

// ─── Helper functions ───────────────────────────────────────────────────────

function getStatusEmoji(status: TaskStatus | BacklogItemStatus): string {
  switch (status) {
    case 'pending':
      return '🟢';
    case 'acknowledged':
      return '📬';
    case 'in_progress':
      return '🔵';
    case 'backlog':
      return '⚪';
    case 'completed':
      return '✅';
    case 'pending_user_review':
      return '👀';
    case 'closed':
      return '🔒';
    default:
      return '⚫';
  }
}

// ─── Content Hash Helper ───────────────────────────────────────────────────

/**
 * Compute a SHA-256 content hash for idempotent import.
 */
// fallow-ignore-next-line unused-export
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ─── Public Functions (unchanged signatures) ────────────────────────────────

/**
 * List backlog items (excludes pending_user_review)
 */
export async function listBacklog(
  chatroomId: string,
  options: ListBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    listBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Add a backlog item
 */
export async function addBacklog(
  chatroomId: string,
  options: AddBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    addBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Complete a backlog item by ID.
 */
export async function completeBacklog(
  chatroomId: string,
  options: CompleteBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    completeBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Reopen a closed backlog item, returning it to backlog status.
 */
export async function reopenBacklog(
  chatroomId: string,
  options: ReopenBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    reopenBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Patch a backlog item's scoring fields (complexity, value, priority).
 */
// fallow-ignore-next-line unused-export
export async function patchBacklog(
  chatroomId: string,
  options: PatchBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    patchBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Score a backlog item by complexity, value, and priority.
 */
export async function scoreBacklog(
  chatroomId: string,
  options: ScoreBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    scoreBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Mark a backlog item as ready for user review.
 */
export async function markForReviewBacklog(
  chatroomId: string,
  options: MarkForReviewBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    markForReviewBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * View completed and closed backlog items by date range.
 */
export async function historyBacklog(
  chatroomId: string,
  options: HistoryBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    historyBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Update the content of an existing backlog item.
 */
export async function updateBacklog(
  chatroomId: string,
  options: UpdateBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    updateBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Close a backlog item (mark as closed/stale).
 */
export async function closeBacklog(
  chatroomId: string,
  options: CloseBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  await Effect.runPromise(
    closeBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(buildBaseLayer(d))
    )
  );
}

/**
 * Export all backlog items to a JSON file.
 */
export async function exportBacklog(
  chatroomId: string,
  options: ExportBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  if (!d.fs) {
    console.error('❌ File system operations not available');
    process.exit(1);
    return;
  }
  await Effect.runPromise(
    exportBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(Layer.merge(buildBaseLayer(d), buildFsLayer(d.fs)))
    )
  );
}

/**
 * Import backlog items from a JSON export file.
 * Idempotent — skips items whose content hash matches an existing item.
 */
export async function importBacklog(
  chatroomId: string,
  options: ImportBacklogOptions,
  deps?: BacklogDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  if (!d.fs) {
    console.error('❌ File system operations not available');
    process.exit(1);
    return;
  }
  await Effect.runPromise(
    importBacklogEffect(chatroomId, options).pipe(
      Effect.catchAll(handleBacklogError),
      Effect.provide(Layer.merge(buildBaseLayer(d), buildFsLayer(d.fs)))
    )
  );
}
