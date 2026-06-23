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

import type { HandoffDeps } from './deps.js';
import { api } from '../../api.js';
import type { Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  SessionService,
  validateChatroomIdEffect,
} from '../../infrastructure/services/index.js';
import {
  formatError,
  formatAuthError,
  formatChatroomIdError,
} from '../../utils/error-formatting.js';

// ─── Re-exports for testing ────────────────────────────────────────────────

export type { HandoffDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface HandoffOptions {
  role: string;
  message: string;
  nextRole: string;
  attachedArtifactIds?: string[];
  attachedWorkflowKeys?: string[];
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type HandoffError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'ArtifactsInvalid' }
  | { readonly _tag: 'ArtifactValidationFailed'; readonly cause: Error }
  | { readonly _tag: 'WorkflowNotFound'; readonly workflowKey: string; readonly cause: Error }
  | {
      readonly _tag: 'HandoffFailed';
      readonly cause: Error;
      readonly errorData?: { code?: string; message?: string };
    }
  | {
      readonly _tag: 'HandoffRejected';
      readonly error: {
        message: string;
        code?: string;
        suggestedTarget?: string;
        suggestedTargets?: string[];
      };
    };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<HandoffDeps> {
  const client = await getConvexClient();
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
  };
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * All errors are typed; caller decides how to handle them.
 */
// fallow-ignore-next-line unused-export complexity
export const handoffEffect = (
  chatroomId: string,
  options: HandoffOptions
): Effect.Effect<void, HandoffError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const session = yield* SessionService;
    const backend = yield* BackendService;
    const {
      role,
      message,
      nextRole,
      attachedArtifactIds = [],
      attachedWorkflowKeys = [],
    } = options;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    // Validate artifact IDs if provided
    if (attachedArtifactIds.length > 0) {
      const areValid = yield* backend
        .query<boolean>(api.artifacts.validateArtifactIds, {
          sessionId,
          artifactIds: attachedArtifactIds as Id<'chatroom_artifacts'>[],
        })
        .pipe(
          Effect.mapError((cause): HandoffError => ({ _tag: 'ArtifactValidationFailed', cause }))
        );

      if (!areValid) {
        return yield* Effect.fail<HandoffError>({ _tag: 'ArtifactsInvalid' });
      }
    }

    // Resolve workflow keys to IDs
    const resolvedWorkflowIds: string[] = [];
    for (const key of attachedWorkflowKeys) {
      const result = yield* backend
        .query<{ workflowId: string }>(api.workflows.resolveWorkflowId, {
          sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          workflowKey: key,
        })
        .pipe(
          Effect.mapError(
            (cause): HandoffError => ({ _tag: 'WorkflowNotFound', workflowKey: key, cause })
          )
        );
      resolvedWorkflowIds.push(result.workflowId);
    }

    // Execute handoff mutation
    const result = yield* backend
      .mutation<{
        success: boolean;
        error?: {
          message: string;
          code?: string;
          suggestedTarget?: string;
          suggestedTargets?: string[];
        };
        supportsNativeIntegration?: boolean;
      }>(api.messages.handoff, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: role,
        content: message,
        targetRole: nextRole,
        ...(attachedArtifactIds.length > 0 && {
          attachedArtifactIds: attachedArtifactIds as Id<'chatroom_artifacts'>[],
        }),
        ...(resolvedWorkflowIds.length > 0 && {
          attachedWorkflowIds: resolvedWorkflowIds as Id<'chatroom_workflows'>[],
        }),
      })
      .pipe(
        Effect.mapError((cause): HandoffError => {
          // Extract Convex error data if available
          let errorData: { code?: string; message?: string } | undefined;
          if (cause instanceof ConvexError) {
            errorData = cause.data as { code?: string; message?: string };
          }
          return { _tag: 'HandoffFailed', cause, errorData };
        })
      );

    // Check for handoff restriction errors
    if (!result.success && result.error) {
      return yield* Effect.fail<HandoffError>({
        _tag: 'HandoffRejected',
        error: result.error,
      });
    }

    // Print success output
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

      if (attachedArtifactIds.length > 0) {
        console.log(`📎 Attached artifacts: ${attachedArtifactIds.length}`);
        attachedArtifactIds.forEach((id) => {
          console.log(`   • ${id}`);
        });
      }
    });

    // Show attached workflow summaries (non-fatal if fails)
    if (resolvedWorkflowIds.length > 0) {
      for (const wfId of resolvedWorkflowIds) {
        yield* Effect.gen(function* () {
          const detail = yield* backend
            .query<{
              workflow: {
                workflowKey: string;
                status: string;
              };
              steps: {
                stepKey: string;
                status: string;
                assigneeRole?: string;
                dependsOn: string[];
              }[];
            }>(api.workflows.getWorkflowDetail, {
              sessionId,
              chatroomId: chatroomId as Id<'chatroom_rooms'>,
              workflowId: wfId as Id<'chatroom_workflows'>,
            })
            .pipe(Effect.catchAll(() => Effect.succeed(null))); // Non-fatal: skip if fails

          if (!detail) return;

          const wf = detail.workflow;
          console.log('');
          console.log(
            `📊 Attached Workflow: ${wf.workflowKey} (${wf.status}, ${detail.steps.length} steps)`
          );

          for (let i = 0; i < detail.steps.length; i++) {
            const step = detail.steps[i];
            const isLast = i === detail.steps.length - 1;
            const prefix = isLast ? '└─' : '├─';
            const statusEmoji =
              step.status === 'completed'
                ? '✅'
                : step.status === 'in_progress'
                  ? '🔄'
                  : step.status === 'cancelled'
                    ? '❌'
                    : '⏳';
            const roleLabel = step.assigneeRole ? ` [${step.assigneeRole}]` : '';
            const deps =
              step.dependsOn.length > 0 ? ` (depends: ${step.dependsOn.join(', ')})` : '';
            console.log(
              `   ${prefix} ${step.stepKey}${roleLabel} ${statusEmoji} ${step.status}${deps}`
            );
          }

          console.log('');
          console.log(
            `   Inspect: chatroom workflow status --chatroom-id=${chatroomId} --workflow-key=${wf.workflowKey}`
          );
          console.log(
            `   View step: chatroom workflow step-view --chatroom-id=${chatroomId} --workflow-key=${wf.workflowKey} --step-key=<key>`
          );
        });
      }
    }
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
// fallow-ignore-next-line complexity
function handleHandoffError(err: HandoffError): Effect.Effect<void> {
  // fallow-ignore-next-line complexity
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      formatAuthError(err.convexUrl, err.otherUrls);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      formatChatroomIdError(err.id);
      process.exit(1);
    } else if (err._tag === 'ArtifactsInvalid') {
      formatError('One or more artifacts not found', [
        'Please create artifacts first:',
        `chatroom artifact create <chatroom-id> --from-file=... --filename=...`,
      ]);
      process.exit(1);
    } else if (err._tag === 'ArtifactValidationFailed') {
      formatError('Failed to validate artifacts', [String(err.cause)]);
      process.exit(1);
    } else if (err._tag === 'WorkflowNotFound') {
      formatError(`Workflow "${err.workflowKey}" not found`, [
        'Check the workflow key and try again',
      ]);
      process.exit(1);
    } else if (err._tag === 'HandoffFailed') {
      console.error(`\n❌ ERROR: Handoff failed`);

      if (err.errorData) {
        console.error(`\n${err.errorData.message || 'An unexpected error occurred'}`);

        if (process.env.CHATROOM_DEBUG === 'true') {
          console.error('\n🔍 Debug Info:');
          console.error(JSON.stringify(err.errorData, null, 2));
        }

        if (err.errorData.code === 'AUTH_FAILED') {
          console.error('\n💡 Try authenticating again:');
          console.error(`   chatroom auth login`);
        } else if (err.errorData.code === 'INVALID_ROLE') {
          console.error('\n💡 Check your team configuration and use a valid role');
        }
      } else {
        console.error(`\n${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);

        if (process.env.CHATROOM_DEBUG === 'true') {
          console.error('\n🔍 Debug Info:');
          console.error(err.cause);
        }
      }

      console.error('\n📚 Need help? Check the docs or run:');
      console.error(`   chatroom handoff --help`);
      process.exit(1);
    } else if (err._tag === 'HandoffRejected') {
      console.error(`\n❌ ERROR: ${err.error.message}`);

      // For invalid target role, show available targets and workflow
      if (err.error.code === 'INVALID_TARGET_ROLE' && err.error.suggestedTargets) {
        console.error(`\n📋 Available handoff targets for this team:`);
        for (const target of err.error.suggestedTargets) {
          console.error(`   • ${target}`);
        }
        console.error(
          `\n💡 Check your team's workflow in the system prompt for valid handoff paths.`
        );
      } else if (err.error.suggestedTarget) {
        console.error(`\n💡 Try this instead:`);
        console.error('```');
        console.error(`   chatroom handoff --next-role=${err.error.suggestedTarget} ...`);
        console.error('```');
      }
      process.exit(1);
    }
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
    handoffEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleHandoffError(err)),
      Effect.provide(layer)
    )
  );
}
