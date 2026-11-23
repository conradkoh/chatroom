/**
 * Publish a validated phased plan (`chatroom plan publish`).
 *
 * Calls Convex directly (no daemon, no CLI gateway), so the command works when
 * the daemon is down. The markdown is pre-validated with the same pure parser
 * the backend uses, so an invalid plan exits 1 with line-numbered errors and
 * nothing is stored; the backend re-validates authoritatively.
 */

import { parsePlan, type PlanParseError } from '@workspace/backend/src/domain/plan/parse-plan.js';
import { Effect } from 'effect';

import {
  isSessionFailure,
  printSessionFailure,
  runPlanCommand,
  type PlanErrorData,
} from './shared.js';
import { api, type Id } from '../../api.js';
import type { ConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import {
  BackendService,
  requireSessionForChatroomEffect,
} from '../../infrastructure/services/index.js';
import type { CommandSessionFailure, SessionService } from '../../infrastructure/services/index.js';
import { getConvexErrorData, getErrorMessage } from '../../utils/convex-error.js';

export interface PublishPlanOptions {
  role: string;
  content: string;
  supersedesPlanId?: string | undefined;
}

interface PublishErrorData extends PlanErrorData {
  errors?: PlanParseError[] | undefined;
}

export type PublishPlanError =
  | CommandSessionFailure
  | { readonly _tag: 'InvalidPlan'; readonly errors: readonly PlanParseError[] }
  | {
      readonly _tag: 'PlanPublishFailed';
      readonly cause: Error;
      readonly errorData?: PublishErrorData | undefined;
    };

interface PublishPlanResult {
  messageId: string;
  planId: string;
  phaseIds: string[];
}

interface PublishFailure {
  cause: Error;
  errorData?: PublishErrorData | undefined;
}

function toPublishFailure(cause: Error): PublishPlanError {
  return {
    _tag: 'PlanPublishFailed',
    cause,
    errorData: getConvexErrorData<PublishErrorData>(cause),
  };
}

function printPlanErrors(errors: readonly PlanParseError[]): void {
  for (const error of errors) {
    console.error(`   line ${error.line}: ${error.code} — ${error.message}`);
  }
}

function printTemplateHint(): void {
  console.error('\n💡 Run `chatroom plan view-template` to see the expected structure.');
}

function printInvalidPlan(errors: readonly PlanParseError[]): void {
  console.error('\n❌ Plan not published');
  printPlanErrors(errors);
  printTemplateHint();
}

function publishFailureMessage(err: PublishFailure): string {
  if (!err.errorData) return getErrorMessage(err.cause);
  return err.errorData.message ?? getErrorMessage(err.cause);
}

function publishFailureErrors(err: PublishFailure): readonly PlanParseError[] {
  if (!err.errorData) return [];
  return err.errorData.errors ?? [];
}

function printPublishFailure(err: PublishFailure): void {
  console.error('\n❌ Plan not published');
  console.error(`\n${publishFailureMessage(err)}`);

  const code = err.errorData?.code;
  if (code === 'INVALID_PLAN') return printInvalidPlanDetails(publishFailureErrors(err));
  if (code === 'NO_ACTIVE_TASK') {
    console.error('\n💡 `plan publish` only works while you are working on a task.');
  }
}

/** INVALID_PLAN from the backend: the plan body is echoed back with a hint. */
function printInvalidPlanDetails(errors: readonly PlanParseError[]): void {
  printPlanErrors(errors);
  printTemplateHint();
}

function printPublishError(err: PublishPlanError): void {
  if (isSessionFailure(err)) return printSessionFailure(err);
  if (err._tag === 'InvalidPlan') return printInvalidPlan(err.errors);
  printPublishFailure(err);
}

function handlePublishError(err: PublishPlanError): Effect.Effect<void> {
  return Effect.sync(() => {
    printPublishError(err);
    process.exit(1);
  });
}

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * Validates before touching the backend so a bad plan stores nothing.
 */
const publishPlanEffect = (
  chatroomId: string,
  options: PublishPlanOptions
): Effect.Effect<void, PublishPlanError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const parsed = parsePlan(options.content);
    if (!parsed.ok) {
      return yield* Effect.fail({ _tag: 'InvalidPlan' as const, errors: parsed.errors });
    }

    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });
    const backend = yield* BackendService;

    const result = yield* backend
      .mutation<PublishPlanResult>(api.plans.publish, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        senderRole: options.role,
        content: options.content,
        ...(options.supersedesPlanId ? { supersedesPlanId: options.supersedesPlanId } : {}),
      })
      .pipe(Effect.mapError(toPublishFailure));

    yield* Effect.sync(() => {
      console.log('✅ Plan published');
      console.log(`   Plan ID: ${result.planId}`);
      console.log(`   Phases: ${result.phaseIds.join(', ')}`);
      console.log(
        `   Cite phases as <planId>#Pn (e.g. ${result.planId}#${result.phaseIds[0] ?? 'P1'}).`
      );
      console.log('Pass this plan ID to the coordinator in your slice report.');
    });
  });

/** CLI entry point: runs the effect and converts typed errors to exit 1. */
export async function publishPlan(
  chatroomId: string,
  options: PublishPlanOptions,
  deps?: ConvexCommandDeps
): Promise<void> {
  await runPlanCommand(deps, publishPlanEffect(chatroomId, options), handlePublishError);
}
