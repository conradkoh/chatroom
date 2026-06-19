/**
 * Workflow commands for managing structured DAG-based workflows.
 *
 * Phase 9: Migrated to Effect-TS services with typed error handling.
 */

import { Effect } from 'effect';

import type { WorkflowDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId, getOtherSessionUrls } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';
import type { SessionService } from '../../infrastructure/services/index.js';
import {
  BackendService,
  commandServicesLayerFromDeps,
  requireSessionIdEffect,
  validateChatroomIdEffect,
} from '../../infrastructure/services/index.js';

// ─── Re-exports ────────────────────────────────────────────────────────────

export type { WorkflowDeps } from './deps.js';

// ─── Constants ──────────────────────────────────────────────────────────

const VALID_CHATROOM_SKILLS = ['backlog', 'software-engineering', 'code-review', 'workflow'];

// ─── Types ─────────────────────────────────────────────────────────────────

type WorkflowStatus = 'draft' | 'active' | 'completed' | 'cancelled';
type StepStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type StepInput = {
  stepKey: string;
  description: string;
  dependsOn: string[];
  order: number;
  [key: string]: unknown;
};

type StepSpec = {
  goal?: string;
  requirements?: string;
  warnings?: string;
  skills?: string;
};

export interface CreateWorkflowOptions {
  role: string;
  workflowKey: string;
  stdinContent: string;
}

export interface SpecifyStepOptions {
  role: string;
  workflowKey: string;
  stepKey: string;
  assigneeRole: string;
  stdinContent: string;
}

export interface ExecuteWorkflowOptions {
  role: string;
  workflowKey: string;
}

export interface WorkflowStatusOptions {
  role: string;
  workflowKey: string;
}

export interface StepCompleteOptions {
  role: string;
  workflowKey: string;
  stepKey: string;
}

export interface ExitWorkflowOptions {
  role: string;
  workflowKey: string;
  reason: string;
}

export interface ViewStepOptions {
  role: string;
  workflowKey: string;
  stepKey: string;
}

// ─── Domain errors ─────────────────────────────────────────────────────────

export type WorkflowError =
  | { readonly _tag: 'NotAuthenticated'; readonly convexUrl: string; readonly otherUrls: string[] }
  | { readonly _tag: 'InvalidChatroomId'; readonly id: string }
  | { readonly _tag: 'InvalidInput'; readonly message: string }
  | { readonly _tag: 'WorkflowNotFound'; readonly workflowKey: string }
  | { readonly _tag: 'MutationFailed'; readonly cause: Error }
  | { readonly _tag: 'QueryFailed'; readonly cause: Error };

// ─── Default Deps Factory ──────────────────────────────────────────────────

async function createDefaultDeps(): Promise<WorkflowDeps> {
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

// ─── Section Parser ────────────────────────────────────────────────────────

/**
 * Parse multi-section stdin content with markers like ---GOAL---, ---REQUIREMENTS---, ---WARNINGS---
 */
// fallow-ignore-next-line unused-export complexity
export function parseSections(
  input: string,
  requiredSections: string[],
  optionalSections: string[]
): Map<string, string> {
  const allSections = [...requiredSections, ...optionalSections];
  const result = new Map<string, string>();

  // Build regex to split on section markers
  const markerPattern = allSections.map((s) => `---${s}---`).join('|');
  const regex = new RegExp(`(${markerPattern})`, 'g');

  // Find all marker positions
  const markers: { section: string; index: number; matchStart: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    const sectionName = (match[1] ?? '').replace(/^---/, '').replace(/---$/, '');
    markers.push({
      section: sectionName,
      index: match.index + match[0].length,
      matchStart: match.index,
    });
  }

  // Extract content between markers
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (!marker) continue;
    const nextMarker = markers[i + 1];
    const start = marker.index;
    const end = nextMarker ? nextMarker.matchStart : input.length;
    const content = input.substring(start, end).trim();
    result.set(marker.section, content);
  }

  // Validate required sections
  for (const section of requiredSections) {
    if (!result.has(section) || !result.get(section)) {
      console.error(`❌ Missing required section: ---${section}---`);
      console.error('');
      console.error('Expected format:');
      for (const s of allSections) {
        const isRequired = requiredSections.includes(s);
        console.error(`   ---${s}---`);
        console.error(
          `   [${s.toLowerCase()} content here${isRequired ? ' (required)' : ' (optional)'}]`
        );
      }
      process.exit(1);
    }
  }

  return result;
}

// ─── Status Emoji ──────────────────────────────────────────────────────────

function getStepStatusEmoji(status: StepStatus): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'in_progress':
      return '🔵';
    case 'completed':
      return '✅';
    case 'cancelled':
      return '❌';
    default:
      return '⚫';
  }
}

function getWorkflowStatusEmoji(status: WorkflowStatus): string {
  switch (status) {
    case 'draft':
      return '📝';
    case 'active':
      return '▶️';
    case 'completed':
      return '✅';
    case 'cancelled':
      return '❌';
    default:
      return '⚫';
  }
}

// ─── Validation Helpers ────────────────────────────────────────────────────

/** Validate a single step object — returns a WorkflowError or null if valid */
function validateStepInput(step: StepInput, index: number): WorkflowError | null {
  const stepLabel = step.stepKey ? `"${step.stepKey}"` : `at index ${index}`;

  if (!step.stepKey || typeof step.stepKey !== 'string') {
    return {
      _tag: 'InvalidInput',
      message: `Step ${stepLabel} must have a "stepKey" (string). All steps require: stepKey, description, dependsOn, order`,
    };
  }
  if (!step.description || typeof step.description !== 'string') {
    return {
      _tag: 'InvalidInput',
      message: `Step ${stepLabel} must have a "description" (string). All steps require: stepKey, description, dependsOn, order`,
    };
  }
  if (!Array.isArray(step.dependsOn)) {
    return {
      _tag: 'InvalidInput',
      message: `Step ${stepLabel} must have a "dependsOn" (array of strings). All steps require: stepKey, description, dependsOn, order`,
    };
  }
  if (typeof step.order !== 'number') {
    return {
      _tag: 'InvalidInput',
      message: `Step ${stepLabel} must have an "order" (number). All steps require: stepKey, description, dependsOn, order`,
    };
  }
  return null;
}

// ─── Rendering Helpers ─────────────────────────────────────────────────────

function formatLocaleDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function renderWorkflowHeader(wf: {
  workflowKey: string;
  status: string;
  createdBy: string;
  createdAt: number;
  completedAt?: number | null;
  cancelledAt?: number | null;
  cancelReason?: string | null;
}): void {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log(`${getWorkflowStatusEmoji(wf.status as WorkflowStatus)} WORKFLOW: ${wf.workflowKey}`);
  console.log('══════════════════════════════════════════════════');
  console.log(`Status: ${wf.status.toUpperCase()}`);
  console.log(`Created by: ${wf.createdBy}`);
  console.log(`Created: ${formatLocaleDate(wf.createdAt)}`);

  if (wf.completedAt) {
    console.log(`Completed: ${formatLocaleDate(wf.completedAt)}`);
  }
  if (wf.cancelledAt) {
    console.log(`Cancelled: ${formatLocaleDate(wf.cancelledAt)}`);
    if (wf.cancelReason) {
      console.log(`Reason: ${wf.cancelReason}`);
    }
  }
}

// fallow-ignore-next-line complexity
function renderWorkflowSteps(
  steps: {
    stepKey: string;
    description: string;
    status: string;
    assigneeRole?: string | null;
    dependsOn: string[];
    order: number;
    specification?: unknown;
    cancelReason?: string | null;
  }[]
): void {
  console.log('');
  console.log('──────────────────────────────────────────────────');
  console.log('📋 STEPS');
  console.log('──────────────────────────────────────────────────');

  if (steps.length === 0) {
    console.log('No steps.');
    return;
  }

  for (const step of steps) {
    const emoji = getStepStatusEmoji(step.status as StepStatus);
    console.log(`${emoji} [${step.status.toUpperCase()}] ${step.stepKey}: ${step.description}`);

    const details: string[] = [];
    if (step.assigneeRole) details.push(`assignee=${step.assigneeRole}`);
    if (step.dependsOn.length > 0) details.push(`depends_on=[${step.dependsOn.join(', ')}]`);
    details.push(`order=${step.order}`);
    console.log(`   ${details.join(' | ')}`);

    if (step.specification) {
      const spec = step.specification as StepSpec;
      if (spec.goal) console.log(`   📎 Goal: ${spec.goal}`);
      if (spec.skills) console.log(`   🔧 Skills: ${spec.skills}`);
      if (spec.requirements) console.log(`   📎 Requirements: ${spec.requirements}`);
      if (spec.warnings) console.log(`   ⚠️  Warnings: ${spec.warnings}`);
    }

    if (step.cancelReason) {
      console.log(`   Cancel reason: ${step.cancelReason}`);
    }

    console.log('');
  }
}

function renderAvailableNextSteps(
  steps: { stepKey: string; description: string }[],
  availableNextSteps: string[]
): void {
  if (availableNextSteps.length === 0) return;

  console.log('──────────────────────────────────────────────────');
  console.log('🔜 AVAILABLE NEXT STEPS');
  console.log('──────────────────────────────────────────────────');
  for (const stepKey of availableNextSteps) {
    const step = steps.find((s) => s.stepKey === stepKey);
    if (step) {
      console.log(`   → ${stepKey}: ${step.description}`);
    }
  }
  console.log('');
}

// fallow-ignore-next-line complexity
function renderStepDetails(
  step: {
    stepKey: string;
    description: string;
    status: string;
    assigneeRole?: string | null;
    dependsOn: string[];
    order: number;
    completedAt?: number | null;
    cancelledAt?: number | null;
    cancelReason?: string | null;
    specification?: unknown;
  },
  result: { workflowKey: string; workflowStatus: string }
): void {
  const emoji = getStepStatusEmoji(step.status as StepStatus);

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log(`${emoji} STEP: ${step.stepKey}`);
  console.log('══════════════════════════════════════════════════');
  console.log(`Workflow: ${result.workflowKey} (${result.workflowStatus})`);
  console.log(`Description: ${step.description}`);
  console.log(`Status: ${step.status.toUpperCase()}`);

  if (step.assigneeRole) console.log(`Assignee: ${step.assigneeRole}`);
  if (step.dependsOn.length > 0) console.log(`Dependencies: ${step.dependsOn.join(', ')}`);
  console.log(`Order: ${step.order}`);

  if (step.completedAt) console.log(`Completed: ${formatLocaleDate(step.completedAt)}`);
  if (step.cancelledAt) {
    console.log(`Cancelled: ${formatLocaleDate(step.cancelledAt)}`);
    if (step.cancelReason) console.log(`Cancel reason: ${step.cancelReason}`);
  }

  if (step.specification) {
    const spec = step.specification as StepSpec;
    console.log('');
    console.log('──────────────────────────────────────────────────');
    console.log('📋 SPECIFICATION');
    console.log('──────────────────────────────────────────────────');
    if (spec.goal) {
      console.log('');
      console.log('Goal:');
      console.log(spec.goal);
    }
    if (spec.skills) {
      console.log('');
      console.log('Skills (activate before starting):');
      console.log(spec.skills);
    }
    if (spec.requirements) {
      console.log('');
      console.log('Requirements:');
      console.log(spec.requirements);
    }
    if (spec.warnings) {
      console.log('');
      console.log('⚠️  Warnings:');
      console.log(spec.warnings);
    }
  } else {
    console.log('');
    console.log('⚠️  No specification set. Run `workflow specify` to add one.');
  }

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('');
}

// ─── Effect Programs ───────────────────────────────────────────────────────

/**
 * Pure Effect program — create a new workflow with steps from JSON stdin.
 */
// fallow-ignore-next-line unused-export complexity
export const createWorkflowEffect = (
  chatroomId: string,
  options: CreateWorkflowOptions
): Effect.Effect<void, WorkflowError, BackendService | SessionService> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    // Parse JSON from stdin
    const stepsData = yield* Effect.try({
      try: () => JSON.parse(options.stdinContent) as { steps: StepInput[] },
      catch: (): WorkflowError => ({
        _tag: 'InvalidInput',
        message:
          'Invalid JSON input. Expected format: { "steps": [{ "stepKey": "...", "description": "...", "dependsOn": [...], "order": N }] }',
      }),
    });

    // Validate structure
    if (!stepsData.steps || !Array.isArray(stepsData.steps)) {
      return yield* Effect.fail<WorkflowError>({
        _tag: 'InvalidInput',
        message: 'JSON must contain a "steps" array',
      });
    }

    if (stepsData.steps.length === 0) {
      return yield* Effect.fail<WorkflowError>({
        _tag: 'InvalidInput',
        message: 'Workflow must have at least one step',
      });
    }

    const ALLOWED_STEP_FIELDS = new Set(['stepKey', 'description', 'dependsOn', 'order']);

    // Validate each step
    for (let i = 0; i < stepsData.steps.length; i++) {
      const step = stepsData.steps[i];
      if (!step) continue;
      const validationError = validateStepInput(step, i);
      if (validationError) {
        return yield* Effect.fail<WorkflowError>(validationError);
      }

      // Warn about extra fields (they will be stripped)
      const extraFields = Object.keys(step).filter((k) => !ALLOWED_STEP_FIELDS.has(k));
      if (extraFields.length > 0) {
        yield* Effect.sync(() => {
          console.error(
            `⚠️  Stripped unknown fields from step "${step.stepKey}": ${extraFields.join(', ')}`
          );
        });
      }
    }

    // Strip to only allowed fields
    const cleanSteps = stepsData.steps.map((step) => ({
      stepKey: step.stepKey,
      description: step.description,
      dependsOn: step.dependsOn,
      order: step.order,
    }));

    const result = yield* backend
      .mutation<{ workflowId: string }>(api.workflows.createWorkflow, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workflowKey: options.workflowKey,
        steps: cleanSteps,
        createdBy: options.role,
      })
      .pipe(Effect.mapError((cause): WorkflowError => ({ _tag: 'MutationFailed', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Workflow created');
      console.log(`   Key: ${options.workflowKey}`);
      console.log(`   Workflow ID: ${result.workflowId}`);
      console.log(`   Steps: ${cleanSteps.length}`);
      console.log(`   Status: draft`);
      console.log('');
    });
  });

/**
 * Pure Effect program — specify a workflow step with goal, requirements, and optional warnings.
 */
// fallow-ignore-next-line unused-export
export const specifyWorkflowStepEffect = (
  chatroomId: string,
  options: SpecifyStepOptions
): Effect.Effect<void, WorkflowError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    // Parse sections from stdin (parseSections calls process.exit on error)
    const sections = yield* Effect.try({
      try: () =>
        parseSections(options.stdinContent, ['GOAL', 'REQUIREMENTS'], ['WARNINGS', 'SKILLS']),
      catch: (e): WorkflowError => ({
        _tag: 'InvalidInput',
        message: e instanceof Error ? e.message : String(e),
      }),
    });

    const goal = sections.get('GOAL') ?? '';
    const requirements = sections.get('REQUIREMENTS') ?? '';
    const warnings = sections.get('WARNINGS') || undefined;
    const skills = sections.get('SKILLS') || undefined;

    // Soft validation: warn on unrecognized skill names
    if (skills) {
      const skillList = skills
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const invalid = skillList.filter((s) => !VALID_CHATROOM_SKILLS.includes(s));
      if (invalid.length > 0) {
        yield* Effect.sync(() => {
          console.warn(
            `⚠️  Unknown skills: ${invalid.join(', ')}. Valid skills: ${VALID_CHATROOM_SKILLS.join(', ')}`
          );
        });
      }
    }

    yield* backend
      .mutation<void>(api.workflows.specifyStep, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workflowKey: options.workflowKey,
        stepKey: options.stepKey,
        assigneeRole: options.assigneeRole,
        goal,
        requirements,
        warnings,
        skills,
      })
      .pipe(Effect.mapError((cause): WorkflowError => ({ _tag: 'MutationFailed', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Step specified');
      console.log(`   Workflow: ${options.workflowKey}`);
      console.log(`   Step: ${options.stepKey}`);
      console.log(`   Assignee: ${options.assigneeRole}`);
      console.log('');
    });
  });

/**
 * Pure Effect program — execute (activate) a draft workflow.
 */
// fallow-ignore-next-line unused-export
export const executeWorkflowEffect = (
  chatroomId: string,
  options: ExecuteWorkflowOptions
): Effect.Effect<void, WorkflowError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    yield* backend
      .mutation<void>(api.workflows.executeWorkflow, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workflowKey: options.workflowKey,
      })
      .pipe(Effect.mapError((cause): WorkflowError => ({ _tag: 'MutationFailed', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Workflow activated');
      console.log(`   Key: ${options.workflowKey}`);
      console.log(`   Status: active`);
      console.log('');
      console.log('💡 Root steps (no dependencies) are now in_progress.');
      console.log('');
    });
  });

/**
 * Pure Effect program — get and display the full status of a workflow.
 */
// fallow-ignore-next-line unused-export
export const getWorkflowStatusEffect = (
  chatroomId: string,
  options: WorkflowStatusOptions
): Effect.Effect<void, WorkflowError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const result = yield* backend
      .query<{
        workflow: {
          workflowKey: string;
          status: string;
          createdBy: string;
          createdAt: number;
          completedAt?: number | null;
          cancelledAt?: number | null;
          cancelReason?: string | null;
        } | null;
        steps: {
          stepKey: string;
          description: string;
          status: string;
          assigneeRole?: string | null;
          dependsOn: string[];
          order: number;
          specification?: unknown;
          cancelReason?: string | null;
        }[];
        availableNextSteps: string[];
      }>(api.workflows.getWorkflowStatus, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workflowKey: options.workflowKey,
      })
      .pipe(Effect.mapError((cause): WorkflowError => ({ _tag: 'QueryFailed', cause })));

    if (!result.workflow) {
      return yield* Effect.fail<WorkflowError>({
        _tag: 'WorkflowNotFound',
        workflowKey: options.workflowKey,
      });
    }

    const workflow = result.workflow;
    yield* Effect.sync(() => {
      renderWorkflowHeader(workflow);
      renderWorkflowSteps(result.steps);
      renderAvailableNextSteps(result.steps, result.availableNextSteps);
      console.log('══════════════════════════════════════════════════');
      console.log('');
    });
  });

/**
 * Pure Effect program — mark a workflow step as completed.
 */
// fallow-ignore-next-line unused-export
export const completeStepEffect = (
  chatroomId: string,
  options: StepCompleteOptions
): Effect.Effect<void, WorkflowError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    yield* backend
      .mutation<void>(api.workflows.completeStep, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workflowKey: options.workflowKey,
        stepKey: options.stepKey,
      })
      .pipe(Effect.mapError((cause): WorkflowError => ({ _tag: 'MutationFailed', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('✅ Step completed');
      console.log(`   Workflow: ${options.workflowKey}`);
      console.log(`   Step: ${options.stepKey}`);
      console.log('');
    });
  });

/**
 * Pure Effect program — exit (cancel) an entire workflow with a required reason.
 */
// fallow-ignore-next-line unused-export
export const exitWorkflowEffect = (
  chatroomId: string,
  options: ExitWorkflowOptions
): Effect.Effect<void, WorkflowError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    if (!options.reason || options.reason.trim().length === 0) {
      return yield* Effect.fail<WorkflowError>({
        _tag: 'InvalidInput',
        message: 'Reason is required when exiting a workflow',
      });
    }

    yield* backend
      .mutation<void>(api.workflows.exitWorkflow, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workflowKey: options.workflowKey,
        reason: options.reason.trim(),
      })
      .pipe(Effect.mapError((cause): WorkflowError => ({ _tag: 'MutationFailed', cause })));

    yield* Effect.sync(() => {
      console.log('');
      console.log('❌ Workflow exited (cancelled)');
      console.log(`   Key: ${options.workflowKey}`);
      console.log(`   Reason: ${options.reason.trim()}`);
      console.log('');
    });
  });

/**
 * Pure Effect program — view the full details of a single workflow step.
 */
// fallow-ignore-next-line unused-export
export const viewStepEffect = (
  chatroomId: string,
  options: ViewStepOptions
): Effect.Effect<void, WorkflowError, BackendService | SessionService> =>
  Effect.gen(function* () {
    const backend = yield* BackendService;

    const sessionId = yield* requireSessionIdEffect((a) => ({
      _tag: 'NotAuthenticated' as const,
      convexUrl: a.convexUrl,
      otherUrls: a.otherUrls,
    }));

    yield* validateChatroomIdEffect(chatroomId, (id) => ({
      _tag: 'InvalidChatroomId' as const,
      id,
    }));

    const result = yield* backend
      .query<{
        workflowKey: string;
        workflowStatus: string;
        step: {
          stepKey: string;
          description: string;
          status: string;
          assigneeRole?: string | null;
          dependsOn: string[];
          order: number;
          completedAt?: number | null;
          cancelledAt?: number | null;
          cancelReason?: string | null;
          specification?: unknown;
        } | null;
      }>(api.workflows.getStepView, {
        sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        workflowKey: options.workflowKey,
        stepKey: options.stepKey,
      })
      .pipe(Effect.mapError((cause): WorkflowError => ({ _tag: 'QueryFailed', cause })));

    if (!result.step) {
      return yield* Effect.fail<WorkflowError>({
        _tag: 'WorkflowNotFound',
        workflowKey: `${options.workflowKey}/${options.stepKey}`,
      });
    }

    const step = result.step;
    yield* Effect.sync(() => {
      renderStepDetails(step, result);
    });
  });

// ─── Error Handlers ────────────────────────────────────────────────────────

/**
 * Maps typed errors to console.error + process.exit(1) effects.
 * This is the ONLY place process.exit is called in the Effect pipeline.
 */
// fallow-ignore-next-line complexity
function handleWorkflowError(err: WorkflowError): Effect.Effect<void> {
  return Effect.sync(() => {
    if (err._tag === 'NotAuthenticated') {
      console.error(`❌ Not authenticated for: ${err.convexUrl}`);

      if (err.otherUrls.length > 0) {
        console.error(`\n💡 You have sessions for other environments:`);
        for (const url of err.otherUrls) {
          console.error(`   • ${url}`);
        }
        console.error(`\n   To use a different environment, set CHATROOM_CONVEX_URL:`);
        console.error(`   CHATROOM_CONVEX_URL=${err.otherUrls[0]} chatroom workflow ...`);
        console.error(`\n   Or to authenticate for the current environment:`);
      }

      console.error(`   chatroom auth login`);
      process.exit(1);
    } else if (err._tag === 'InvalidChatroomId') {
      console.error(
        `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${err.id?.length || 0})`
      );
      process.exit(1);
    } else if (err._tag === 'InvalidInput') {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    } else if (err._tag === 'WorkflowNotFound') {
      console.error(`❌ Workflow not found: ${err.workflowKey}`);
      process.exit(1);
    } else if (err._tag === 'MutationFailed') {
      console.error(`❌ Operation failed: ${err.cause.message}`);
      process.exit(1);
    } else if (err._tag === 'QueryFailed') {
      console.error(`❌ Operation failed: ${err.cause.message}`);
      process.exit(1);
    }
  });
}

// ─── Entry Points (public API — unchanged signatures) ─────────────────────

/**
 * Create a new workflow with steps from JSON stdin.
 */
export async function createWorkflow(
  chatroomId: string,
  options: CreateWorkflowOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    createWorkflowEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleWorkflowError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Specify a workflow step with goal, requirements, and optional warnings.
 */
export async function specifyWorkflowStep(
  chatroomId: string,
  options: SpecifyStepOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    specifyWorkflowStepEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleWorkflowError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Execute (activate) a draft workflow.
 */
export async function executeWorkflow(
  chatroomId: string,
  options: ExecuteWorkflowOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    executeWorkflowEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleWorkflowError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Get and display the full status of a workflow.
 */
export async function getWorkflowStatus(
  chatroomId: string,
  options: WorkflowStatusOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    getWorkflowStatusEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleWorkflowError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Mark a workflow step as completed.
 */
export async function completeStep(
  chatroomId: string,
  options: StepCompleteOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    completeStepEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleWorkflowError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * Exit (cancel) an entire workflow with a required reason.
 */
export async function exitWorkflow(
  chatroomId: string,
  options: ExitWorkflowOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    exitWorkflowEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleWorkflowError(err)),
      Effect.provide(layer)
    )
  );
}

/**
 * View the full details of a single workflow step.
 */
export async function viewStep(
  chatroomId: string,
  options: ViewStepOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const layer = commandServicesLayerFromDeps(d);

  await Effect.runPromise(
    viewStepEffect(chatroomId, options).pipe(
      Effect.catchAll((err) => handleWorkflowError(err)),
      Effect.provide(layer)
    )
  );
}
