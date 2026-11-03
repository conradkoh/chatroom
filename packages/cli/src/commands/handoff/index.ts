/**
 * Complete a task and hand off to the next role
 *
 * This command uses the atomic handoff mutation which performs all of
 * these operations in a single transaction:
 * 1. Validates the handoff is allowed (classification rules)
 * 2. Completes all in_progress tasks in the chatroom
 * 3. Sends the handoff message
 * 4. Creates a task for the target agent (if not handing to user)
 * 5. Updates the sender's participant status to waiting
 * 6. Promotes the next queued task to pending
 * Phase 4: Migrated to Effect-TS services with typed error handling.
 */

import { generateHandoffOutput } from '@workspace/backend/prompts/generator.js';
import { ConvexError } from 'convex/values';
import { Effect } from 'effect';

import {
  discardHandoffAttachments,
  prepareHandoffAttachments,
  uploadHandoffAttachments,
} from './attachments.js';
import type {
  HandoffDeps,
  FileAttachmentUploaderOps,
  HandoffGatewayOps,
  HandoffResult,
} from './deps.js';
import { LocalDaemonServerError } from '../../commands/diagnostics/local-daemon.js';
import { createLocalHandoffGateway } from '../../infrastructure/cli-gateway/local-handoff-gateway.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import { createConvexFileAttachmentUploader } from '../../infrastructure/file-attachments/convex-file-attachment-uploader.js';
import {
  CliGatewayService,
  commandServicesLayerFromDeps,
  requireSessionForChatroomEffect,
  SessionService,
} from '../../infrastructure/services/index.js';
import { formatAuthError, formatChatroomIdError } from '../../utils/error-formatting.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { HandoffDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HandoffOptions {
  role: string;
  message: string;
  nextRole: string;
  /** Local paths to attach; only valid when `nextRole` is `user`. */
  attachFiles?: string[] | undefined;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type HandoffError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | {
      readonly _tag: 'HandoffFailed';
      readonly cause: Error;
      readonly errorData?: { code?: string | undefined; message?: string | undefined } | undefined;
    }
  | {
      readonly _tag: 'HandoffRejected';
      readonly error: {
        message: string;
        code?: string | undefined;
        suggestedTarget?: string | undefined;
        suggestedTargets?: string[] | undefined;
      };
    }
  | { readonly _tag: 'AttachmentsRequireUserTarget' }
  | {
      readonly _tag: 'AttachmentLimitExceeded';
      readonly max: number;
      readonly count: number;
    }
  | {
      readonly _tag: 'AttachmentInvalid';
      readonly path: string;
      readonly reason: string;
    }
  | {
      readonly _tag: 'AttachmentUploadFailed';
      readonly filename: string;
      readonly code: string;
      readonly message: string;
    };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<HandoffDeps> {
  const deps = await createConvexCommandDeps();
  return {
    backend: deps.backend,
    gateway: createLocalHandoffGateway(),
    session: deps.session,
    attachmentUploader: createConvexFileAttachmentUploader(deps.backend),
  };
}

// ─── Effect Programs ───────────────────────────────────────────────────────

type HandoffRequest = {
  sessionId: string;
  chatroomId: string;
  senderRole: string;
  content: string;
  targetRole: string;
  attachedFileIds?: string[] | undefined;
};

/** Maps a thrown gateway failure onto the typed `HandoffFailed` variant. */
function toHandoffFailure(cause: Error): HandoffError {
  let errorData: { code?: string | undefined; message?: string | undefined } | undefined;
  if (cause instanceof ConvexError) {
    errorData = cause.data as { code?: string | undefined; message?: string | undefined };
  } else if (cause instanceof LocalDaemonServerError && cause.details) {
    errorData = cause.details as { code?: string | undefined; message?: string | undefined };
  }
  return { _tag: 'HandoffFailed', cause, errorData };
}

/** Calls the handoff gateway and normalises transport failures. */
function callHandoffGateway(
  gateway: HandoffGatewayOps['handoff'],
  request: HandoffRequest
): Effect.Effect<HandoffResult, HandoffError> {
  return Effect.tryPromise({
    try: () => gateway(request),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(Effect.mapError(toHandoffFailure));
}

/** Discards uploads only when a failed handoff left bound ids behind. */
function discardAfterFailedHandoff(
  uploader: FileAttachmentUploaderOps | undefined,
  sessionId: string,
  attachedFileIds: string[] | undefined
): Effect.Effect<void> {
  if (!uploader || !attachedFileIds || attachedFileIds.length === 0) return Effect.void;
  return discardHandoffAttachments(uploader, sessionId, attachedFileIds);
}

/**
 * Runs the handoff mutation. A failed or rejected handoff leaves the uploads
 * unbound, so cleanup runs before the original error is re-raised. Cleanup
 * errors never mask the original failure.
 */
function performHandoff(args: {
  gateway: HandoffGatewayOps['handoff'];
  request: HandoffRequest;
  uploader: FileAttachmentUploaderOps | undefined;
  sessionId: string;
  attachedFileIds: string[] | undefined;
}): Effect.Effect<HandoffResult, HandoffError> {
  return Effect.gen(function* () {
    const result = yield* callHandoffGateway(args.gateway, args.request);
    if (!result.success && result.error) {
      return yield* Effect.fail<HandoffError>({
        _tag: 'HandoffRejected',
        error: result.error,
      });
    }
    return result;
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* discardAfterFailedHandoff(args.uploader, args.sessionId, args.attachedFileIds);
        return yield* Effect.fail(error);
      })
    )
  );
}

/** Validates and uploads attachments when any were supplied. */
function uploadHandoffFiles(
  uploader: FileAttachmentUploaderOps | undefined,
  args: {
    sessionId: string;
    chatroomId: string;
    senderRole: string;
    nextRole: string;
    attachFiles: readonly string[];
  }
): Effect.Effect<string[] | undefined, HandoffError> {
  return Effect.gen(function* () {
    if (args.attachFiles.length === 0) return undefined;
    if (!uploader) {
      return yield* Effect.fail<HandoffError>({
        _tag: 'AttachmentUploadFailed',
        filename: '',
        code: 'UPLOAD_UNAVAILABLE',
        message: 'File attachments are not available in this environment',
      });
    }

    const files = yield* prepareHandoffAttachments(args.attachFiles, args.nextRole);
    return yield* uploadHandoffAttachments(uploader, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
      senderRole: args.senderRole,
      files,
    });
  });
}

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export complexity
export const handoffEffect = (
  chatroomId: string,
  options: HandoffOptions,
  attachmentUploader?: FileAttachmentUploaderOps
): Effect.Effect<void, HandoffError, CliGatewayService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const session = yield* SessionService;
    const gateway = yield* CliGatewayService;
    const { role, message, nextRole, attachFiles = [] } = options;

    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });
    const attachedFileIds = yield* uploadHandoffFiles(attachmentUploader, {
      sessionId,
      chatroomId,
      senderRole: role,
      nextRole,
      attachFiles,
    });

    const result = yield* performHandoff({
      gateway: gateway.handoff,
      request: {
        sessionId,
        chatroomId,
        senderRole: role,
        content: message,
        targetRole: nextRole,
        ...(attachedFileIds ? { attachedFileIds } : {}),
      },
      uploader: attachmentUploader,
      sessionId,
      attachedFileIds,
    });

    const convexUrl = yield* session.getConvexUrl();

    yield* Effect.sync(() => {
      console.log(
        generateHandoffOutput({
          role,
          nextRole,
          chatroomId,
          convexUrl,
          supportsNativeIntegration: result.supportsNativeIntegration,
        })
      );
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

type HandoffFailedError = Extract<HandoffError, { _tag: 'HandoffFailed' }>;
type HandoffRejectedError = Extract<HandoffError, { _tag: 'HandoffRejected' }>;
type SessionFailure = Extract<HandoffError, { _tag: 'NotAuthenticated' | 'InvalidChatroomId' }>;
type AttachmentFailure = Extract<
  HandoffError,
  {
    _tag:
      | 'AttachmentsRequireUserTarget'
      | 'AttachmentLimitExceeded'
      | 'AttachmentInvalid'
      | 'AttachmentUploadFailed';
  }
>;

/** Prints session/chatroom-id guidance; narrows away from every other error. */
function handleSessionError(err: HandoffError): err is SessionFailure {
  switch (err._tag) {
    case 'NotAuthenticated':
      formatAuthError(err.convexUrl, err.otherUrls);
      return true;
    case 'InvalidChatroomId':
      formatChatroomIdError(err.id);
      return true;
    default:
      return false;
  }
}

function printDebugInfo(value: unknown): void {
  if (process.env.CHATROOM_DEBUG !== 'true') return;
  console.error('\n🔍 Debug Info:');
  console.error(value);
}

function printHandoffFailureHint(code: string | undefined): void {
  if (code === 'AUTH_FAILED') {
    console.error('\n💡 Try authenticating again:');
    console.error(`   chatroom auth login`);
  } else if (code === 'INVALID_ROLE') {
    console.error('\n💡 Check your team configuration and use a valid role');
  }
}

function printHandoffFailed(err: HandoffFailedError): void {
  console.error(`\n❌ ERROR: Handoff failed`);

  if (err.errorData) {
    console.error(`\n${err.errorData.message || 'An unexpected error occurred'}`);
    printDebugInfo(JSON.stringify(err.errorData, null, 2));
    printHandoffFailureHint(err.errorData.code);
  } else {
    console.error(`\n${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);
    printDebugInfo(err.cause);
  }

  console.error('\n📚 Need help? Check the docs or run:');
  console.error(`   chatroom handoff --help`);
}

function printSuggestedTargets(targets: readonly string[]): void {
  console.error(`\n📋 Available handoff targets for this team:`);
  for (const target of targets) {
    console.error(`   • ${target}`);
  }
  console.error(`\n💡 Check your team's handoff rules in the system prompt for valid paths.`);
}

function printSuggestedTarget(target: string): void {
  console.error(`\n💡 Try this instead:`);
  console.error('```');
  console.error(`   chatroom handoff --next-role=${target} ...`);
  console.error('```');
}

function printHandoffRejected(err: HandoffRejectedError): void {
  console.error(`\n❌ ERROR: ${err.error.message}`);

  if (err.error.code === 'INVALID_TARGET_ROLE' && err.error.suggestedTargets) {
    printSuggestedTargets(err.error.suggestedTargets);
  } else if (err.error.suggestedTarget) {
    printSuggestedTarget(err.error.suggestedTarget);
  }
}

function printAttachmentTargetFailure(
  err: Extract<
    AttachmentFailure,
    { _tag: 'AttachmentsRequireUserTarget' | 'AttachmentLimitExceeded' }
  >
): void {
  if (err._tag === 'AttachmentsRequireUserTarget') {
    console.error(
      `\n❌ ERROR: --attach-file can only be used with --next-role=user. Agent-to-agent handoffs cannot carry files.`
    );
    return;
  }
  console.error(
    `\n❌ ERROR: Too many files. At most ${err.max} files can be attached to one handoff (got ${err.count}).`
  );
}

function printAttachmentUploadFailure(
  err: Extract<AttachmentFailure, { _tag: 'AttachmentInvalid' | 'AttachmentUploadFailed' }>
): void {
  if (err._tag === 'AttachmentInvalid') {
    console.error(`\n❌ ERROR: Cannot attach "${err.path}": ${err.reason}`);
    return;
  }
  console.error(`\n❌ ERROR: Failed to upload "${err.filename}": ${err.message}`);
  console.error(`   Code: ${err.code}`);
}

function printAttachmentFailure(err: AttachmentFailure): void {
  if (err._tag === 'AttachmentsRequireUserTarget' || err._tag === 'AttachmentLimitExceeded') {
    printAttachmentTargetFailure(err);
    return;
  }
  printAttachmentUploadFailure(err);
}

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
function handleHandoffError(err: HandoffError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (handleSessionError(err)) {
      process.exit(1);
      return;
    }

    switch (err._tag) {
      case 'HandoffFailed':
        printHandoffFailed(err);
        break;
      case 'HandoffRejected':
        printHandoffRejected(err);
        break;
      default:
        printAttachmentFailure(err);
        break;
    }
    process.exit(1);
  });
}

// ─── Entry Point (public API — unchanged signature) ──────────────────────

/**
 * Complete a task and hand off to the next role
 * Runs the Effect and converts typed errors to process.exit + console.error.
 */
export async function handoff(
  chatroomId: string,
  options: HandoffOptions,
  deps?: HandoffDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    handoffEffect(chatroomId, options, d.attachmentUploader).pipe(
      Effect.catch((err) => handleHandoffError(err)),
      Effect.provide(layer)
    )
  );
}
