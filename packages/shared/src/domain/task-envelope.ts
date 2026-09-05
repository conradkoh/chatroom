/**
 * Canonical task-envelope contract (TaskEnvelopeV1).
 *
 * A task envelope is the single policy snapshot that owns the immutable,
 * per-message conversation mode, the session policy (request intent), and the
 * declarative handoff workflow (preset + phase) for a task.
 *
 * Constraints (see acceptance criteria):
 * - Queued envelopes are edited by replacing the whole value. Later queue rows
 *   may replace this value wholesale; they must not mutate nested fields.
 * - Promoted task snapshots are immutable. Task-promotion code must copy this
 *   value before storing; it must never mutate the snapshot it was handed.
 * - The session policy is request intent only (`continue` | `new`). One-shot
 *   consumption (whether a new session was actually started) is execution
 *   state and is intentionally out of scope for this contract.
 * - The mode-to-workflow mapping never controls team capability. Handoff
 *   targets and team/role capability are resolved elsewhere; this module only
 *   describes the recommended workflow preset/phase for a conversation mode.
 *
 * This module is dependency-light and pure: it imports no Convex validators
 * and no backend code, so Convex and UI adapters can share one validation
 * boundary.
 */

import {
  CONVERSATION_MODES,
  legacyConversationMode,
  type ConversationMode,
} from './conversation-mode';

export const TASK_ENVELOPE_VERSION = 1 as const;

export const HANDOFF_WORKFLOW_PRESETS = ['direct', 'team', 'enhanced-team'] as const;
export type HandoffWorkflowPreset = (typeof HANDOFF_WORKFLOW_PRESETS)[number];

export const HANDOFF_WORKFLOW_PHASES = [
  'entry',
  'enhancement',
  'implementation',
  'delivery',
] as const;
export type HandoffWorkflowPhase = (typeof HANDOFF_WORKFLOW_PHASES)[number];

/** Request intent for whether a task should start a fresh session. */
export const TASK_SESSION_POLICIES = ['continue', 'new'] as const;
export type TaskSessionPolicy = (typeof TASK_SESSION_POLICIES)[number];

export interface TaskEnvelopeV1 {
  readonly version: typeof TASK_ENVELOPE_VERSION;
  readonly conversationMode: ConversationMode;
  readonly sessionPolicy: TaskSessionPolicy;
  readonly handoffWorkflow: Readonly<{
    preset: HandoffWorkflowPreset;
    phase: HandoffWorkflowPhase;
  }>;
}

/** Legacy read/write shape used only by migration adapters. */
export interface LegacyTaskDeliverySettings {
  readonly taskEnvelope?: unknown;
  readonly conversationMode?: ConversationMode | undefined;
  readonly plannerEnhancerEnabled?: boolean | undefined;
  readonly startInNewSession?: boolean | undefined;
}

export interface CreateTaskEnvelopeOptions {
  readonly conversationMode?: ConversationMode | undefined;
  readonly sessionPolicy?: TaskSessionPolicy | undefined;
}

/** Default workflow preset for each conversation mode. */
const MODE_DEFAULT_PRESET: Record<ConversationMode, HandoffWorkflowPreset> = {
  chat: 'direct',
  code: 'team',
  'code:enhanced': 'enhanced-team',
};

/**
 * Next-phase matrix, exhaustive over every (preset, phase) pair.
 * Terminal `delivery` maps to itself, making advancement idempotent at the end.
 */
const NEXT_PHASE_BY_PRESET_AND_PHASE: Readonly<
  Record<HandoffWorkflowPreset, Readonly<Record<HandoffWorkflowPhase, HandoffWorkflowPhase>>>
> = {
  direct: {
    entry: 'delivery',
    enhancement: 'delivery',
    implementation: 'delivery',
    delivery: 'delivery',
  },
  team: {
    entry: 'implementation',
    enhancement: 'implementation',
    implementation: 'delivery',
    delivery: 'delivery',
  },
  'enhanced-team': {
    entry: 'enhancement',
    enhancement: 'implementation',
    implementation: 'delivery',
    delivery: 'delivery',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConversationMode(value: unknown): value is ConversationMode {
  return (CONVERSATION_MODES as readonly unknown[]).includes(value);
}

function isSessionPolicy(value: unknown): value is TaskSessionPolicy {
  return (TASK_SESSION_POLICIES as readonly unknown[]).includes(value);
}

function isHandoffPreset(value: unknown): value is HandoffWorkflowPreset {
  return (HANDOFF_WORKFLOW_PRESETS as readonly unknown[]).includes(value);
}

function isHandoffPhase(value: unknown): value is HandoffWorkflowPhase {
  return (HANDOFF_WORKFLOW_PHASES as readonly unknown[]).includes(value);
}

function assertConversationMode(value: unknown, origin: string): asserts value is ConversationMode {
  if (!isConversationMode(value)) {
    throw new TypeError(
      `taskEnvelope: invalid conversationMode ${JSON.stringify(value)} in ${origin}`
    );
  }
}

function assertSessionPolicy(value: unknown, origin: string): asserts value is TaskSessionPolicy {
  if (!isSessionPolicy(value)) {
    throw new TypeError(
      `taskEnvelope: invalid sessionPolicy ${JSON.stringify(value)} in ${origin}`
    );
  }
}

function workflowPresetForMode(mode: ConversationMode): HandoffWorkflowPreset {
  return MODE_DEFAULT_PRESET[mode];
}

/** Builds a complete envelope from validated mode and session-policy literals. */
function buildTaskEnvelope(
  conversationMode: ConversationMode,
  sessionPolicy: TaskSessionPolicy
): TaskEnvelopeV1 {
  return {
    version: TASK_ENVELOPE_VERSION,
    conversationMode,
    sessionPolicy,
    handoffWorkflow: {
      preset: workflowPresetForMode(conversationMode),
      phase: 'entry',
    },
  };
}

/** Returns a structurally fresh copy of an already-valid envelope. */
function copyTaskEnvelope(envelope: TaskEnvelopeV1): TaskEnvelopeV1 {
  return {
    version: TASK_ENVELOPE_VERSION,
    conversationMode: envelope.conversationMode,
    sessionPolicy: envelope.sessionPolicy,
    handoffWorkflow: {
      preset: envelope.handoffWorkflow.preset,
      phase: envelope.handoffWorkflow.phase,
    },
  };
}

function isEnvelopeRecordAndVersion(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.version === TASK_ENVELOPE_VERSION;
}

function isWorkflowShape(workflow: unknown): boolean {
  return isRecord(workflow) && isHandoffPreset(workflow.preset) && isHandoffPhase(workflow.phase);
}

function isPresetChoice(workflow: unknown, mode: ConversationMode): boolean {
  return (
    (workflow as { preset: HandoffWorkflowPreset; phase: HandoffWorkflowPhase }).preset ===
    workflowPresetForMode(mode)
  );
}

function isEnvelopeWorkflowValid(value: Record<string, unknown>, mode: ConversationMode): boolean {
  return isWorkflowShape(value.handoffWorkflow) && isPresetChoice(value.handoffWorkflow, mode);
}

/**
 * Creates a complete envelope, defaulting to `code` + `continue` and deriving
 * the mode's default workflow (preset + entry phase).
 */
export function createTaskEnvelope(options: CreateTaskEnvelopeOptions = {}): TaskEnvelopeV1 {
  return buildTaskEnvelope(options.conversationMode ?? 'code', options.sessionPolicy ?? 'continue');
}

/**
 * Total runtime type guard. Returns false (never throws) for null, arrays,
 * wrong versions, unknown enum values, a missing/malformed workflow, or a
 * mode/preset mismatch; the mode-to-preset invariant is enforced.
 */
export function isTaskEnvelopeV1(value: unknown): value is TaskEnvelopeV1 {
  if (!isEnvelopeRecordAndVersion(value)) return false;
  if (!isConversationMode(value.conversationMode)) return false;
  if (!isSessionPolicy(value.sessionPolicy)) return false;
  return isEnvelopeWorkflowValid(value, value.conversationMode);
}

/** Derives the legacy conversation-mode scalar, rejecting unknown values. */
function deriveLegacyMode(input: LegacyTaskDeliverySettings): ConversationMode {
  const rawMode = input.conversationMode;
  if (rawMode !== undefined) {
    assertConversationMode(rawMode, 'normalizeTaskEnvelope');
    return rawMode;
  }
  return legacyConversationMode(input.plannerEnhancerEnabled);
}

function deriveLegacySession(startInNewSession?: boolean): TaskSessionPolicy {
  return startInNewSession === true ? 'new' : 'continue';
}

/**
 * Normalizes a legacy/scalar or envelope-based settings value into a complete
 * TaskEnvelopeV1.
 *
 * - A valid explicit envelope wins over every legacy scalar and is returned as
 *   a fresh structure.
 * - A malformed/unknown explicit envelope throws a TypeError; it is never
 *   silently coerced.
 * - Without an envelope, an explicit conversation mode wins over the enhancer
 *   boolean; otherwise `plannerEnhancerEnabled: true` maps to `code:enhanced`
 *   and `false`/`undefined` maps to historical `code`. `startInNewSession: true`
 *   maps to `new`; `false`/`undefined` maps to `continue`.
 */
export function normalizeTaskEnvelope(input: LegacyTaskDeliverySettings): TaskEnvelopeV1 {
  if (input.taskEnvelope !== undefined) {
    if (!isTaskEnvelopeV1(input.taskEnvelope)) {
      throw new TypeError('taskEnvelope: invalid explicit TaskEnvelopeV1 value');
    }
    return copyTaskEnvelope(input.taskEnvelope);
  }
  return buildTaskEnvelope(deriveLegacyMode(input), deriveLegacySession(input.startInNewSession));
}

/**
 * Returns a fresh complete envelope with a new conversation mode. The workflow
 * resets to the new mode's default preset and `entry` phase; the session policy
 * is preserved. The input envelope is never mutated.
 */
export function withTaskEnvelopeConversationMode(
  envelope: TaskEnvelopeV1,
  conversationMode: ConversationMode
): TaskEnvelopeV1 {
  assertConversationMode(conversationMode, 'withTaskEnvelopeConversationMode');
  return buildTaskEnvelope(conversationMode, envelope.sessionPolicy);
}

/**
 * Returns a fresh complete envelope with a new session policy. The mode and the
 * current workflow (copied) are preserved exactly. The input envelope is never
 * mutated.
 */
export function withTaskEnvelopeSessionPolicy(
  envelope: TaskEnvelopeV1,
  sessionPolicy: TaskSessionPolicy
): TaskEnvelopeV1 {
  assertSessionPolicy(sessionPolicy, 'withTaskEnvelopeSessionPolicy');
  return {
    version: TASK_ENVELOPE_VERSION,
    conversationMode: envelope.conversationMode,
    sessionPolicy,
    handoffWorkflow: {
      preset: envelope.handoffWorkflow.preset,
      phase: envelope.handoffWorkflow.phase,
    },
  };
}

/**
 * Returns a fresh complete envelope advanced one step through the workflow
 * matrix for its preset. Advancing at terminal `delivery` is idempotent. Mode
 * and session policy are preserved; the input envelope is never mutated.
 */
export function advanceTaskEnvelopeWorkflow(envelope: TaskEnvelopeV1): TaskEnvelopeV1 {
  return {
    version: TASK_ENVELOPE_VERSION,
    conversationMode: envelope.conversationMode,
    sessionPolicy: envelope.sessionPolicy,
    handoffWorkflow: {
      preset: envelope.handoffWorkflow.preset,
      phase:
        NEXT_PHASE_BY_PRESET_AND_PHASE[envelope.handoffWorkflow.preset][
          envelope.handoffWorkflow.phase
        ],
    },
  };
}
