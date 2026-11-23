/**
 * Read a published plan, or one phase of it (`chatroom plan read`).
 *
 * Calls Convex directly (no daemon, no CLI gateway). The plan id is the message
 * id returned by `plan publish`; `--phase Pn` projects one phase with the same
 * renderer the backend tests use.
 */

import { parsePlan } from '@workspace/backend/src/domain/plan/parse-plan.js';
import { renderPlanPhase } from '@workspace/backend/src/domain/plan/render-plan-phase.js';
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

export interface ReadPlanOptions {
  /** Accepted so the prompt text keeps working. The backend identifies the reader from the session, so this is not read. */
  role?: string | undefined;
  planId: string;
  phase?: string | undefined;
}

export interface PlanDetail {
  planId: string;
  senderRole: string;
  createdAt: number;
  content: string;
  supersedes: string | null;
  supersededBy: string | null;
}

export type ReadPlanError =
  | CommandSessionFailure
  | {
      readonly _tag: 'PhaseNotFound';
      readonly phaseId: string;
      readonly available: readonly string[];
    }
  | { readonly _tag: 'UnparsablePlan'; readonly content: string }
  | {
      readonly _tag: 'PlanReadFailed';
      readonly cause: Error;
      readonly errorData?: PlanErrorData | undefined;
    };

interface ReadFailure {
  cause: Error;
  errorData?: PlanErrorData | undefined;
}

function toReadFailure(cause: Error): ReadPlanError {
  return { _tag: 'PlanReadFailed', cause, errorData: getConvexErrorData<PlanErrorData>(cause) };
}

function normalizePhaseId(phase: string): string {
  return phase.trim().toUpperCase();
}

function resolvePlanOutput(
  plan: PlanDetail,
  phaseId: string | null
): Effect.Effect<string, ReadPlanError> {
  if (phaseId === null) return Effect.succeed(plan.content);

  const parsed = parsePlan(plan.content);
  if (!parsed.ok) return Effect.fail({ _tag: 'UnparsablePlan', content: plan.content });

  const rendered = renderPlanPhase(parsed.plan, phaseId);
  if (rendered === null) {
    return Effect.fail({
      _tag: 'PhaseNotFound',
      phaseId,
      available: parsed.plan.phases.map((phase) => phase.id),
    });
  }
  return Effect.succeed(rendered);
}

function printPlanHeader(plan: PlanDetail): void {
  console.log(`Plan ID: ${plan.planId}`);
  console.log(`Author: ${plan.senderRole}`);
  console.log(`Created: ${new Date(plan.createdAt).toISOString()}`);
  if (plan.supersedes) console.log(`Supersedes: ${plan.supersedes}`);
  if (plan.supersededBy) console.log(`⚠ Superseded by ${plan.supersededBy}`);
}

/**
 * Pure Effect program — no process.exit, no console.error inside.
 * A malformed or foreign id surfaces as `PLAN_NOT_FOUND` from the backend.
 */
const readPlanEffect = (
  chatroomId: string,
  options: ReadPlanOptions
): Effect.Effect<void, ReadPlanError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const sessionId = yield* requireSessionForChatroomEffect({ chatroomId });
    const backend = yield* BackendService;

    const plan = yield* backend
      .query<PlanDetail>(api.plans.get, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        planId: options.planId,
      })
      .pipe(Effect.mapError(toReadFailure));

    const phaseId = options.phase === undefined ? null : normalizePhaseId(options.phase);
    const output = yield* resolvePlanOutput(plan, phaseId);

    yield* Effect.sync(() => {
      printPlanHeader(plan);
      console.log('');
      console.log(output);
    });
  });

function printPhaseNotFound(err: { phaseId: string; available: readonly string[] }): void {
  console.error(`\n❌ Phase not found: ${err.phaseId}`);
  console.error(`   Available phases: ${err.available.join(', ')}`);
}

function printUnparsablePlan(content: string): void {
  console.error('\n❌ Cannot read a phase: the stored plan does not match the current template.');
  console.error('   Showing the raw content:\n');
  console.error(content);
}

function printPlanReadFailure(err: ReadFailure): void {
  if (err.errorData?.code === 'PLAN_NOT_FOUND') {
    console.error(`\n❌ ${getErrorMessage(err.cause)}`);
    console.error('   Check the plan id reported by the plan author.');
    return;
  }
  console.error('\n❌ Could not read plan');
  console.error(`\n${getErrorMessage(err.cause)}`);
}

function printPlanReadError(err: Exclude<ReadPlanError, CommandSessionFailure>): void {
  if (err._tag === 'PhaseNotFound') return printPhaseNotFound(err);
  if (err._tag === 'UnparsablePlan') return printUnparsablePlan(err.content);
  printPlanReadFailure(err);
}

function printReadError(err: ReadPlanError): void {
  if (isSessionFailure(err)) return printSessionFailure(err);
  printPlanReadError(err);
}

function handleReadError(err: ReadPlanError): Effect.Effect<void> {
  return Effect.sync(() => {
    printReadError(err);
    process.exit(1);
  });
}

/** CLI entry point: runs the effect and converts typed errors to exit 1. */
export async function readPlan(
  chatroomId: string,
  options: ReadPlanOptions,
  deps?: ConvexCommandDeps
): Promise<void> {
  await runPlanCommand(deps, readPlanEffect(chatroomId, options), handleReadError);
}
