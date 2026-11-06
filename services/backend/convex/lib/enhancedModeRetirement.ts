/**
 * Pure remap helpers that retire the `code:enhanced` conversation mode.
 *
 * Keep these helpers untyped (`unknown` in, plain record out): they run from a
 * data migration that must keep working after the schema and shared types stop
 * accepting `code:enhanced`, `enhanced-team`, and `enhancement`.
 *
 * Agreed mapping:
 * - `conversationMode: 'code:enhanced'` → `'code'`
 * - `handoffWorkflow.preset: 'enhanced-team'` → `'team'`
 * - `handoffWorkflow.phase: 'enhancement'` → `'implementation'`
 *
 * `entry`, `implementation`, and `delivery` phases are unchanged, as are all
 * other envelope fields.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps a stored scalar conversationMode. `'code:enhanced'` → `'code'`; anything
 * else (including `undefined` and unknown values) → `null` (no change).
 */
export function retireEnhancedScalarMode(mode: unknown): 'code' | null {
  return mode === 'code:enhanced' ? 'code' : null;
}

// fallow-ignore-next-line complexity
function remapWorkflow(workflow: unknown): Record<string, unknown> | null {
  if (!isRecord(workflow)) return null;

  let next: Record<string, unknown> | null = null;
  if (workflow.preset === 'enhanced-team') {
    next = { ...(next ?? workflow), preset: 'team' };
  }
  if (workflow.phase === 'enhancement') {
    next = { ...(next ?? workflow), phase: 'implementation' };
  }
  return next;
}

/**
 * Returns a rewritten envelope when it holds conversationMode `'code:enhanced'`,
 * preset `'enhanced-team'`, or phase `'enhancement'`; `null` when no change is
 * needed (including `undefined` and non-record input).
 *
 * Never mutates the input: changed envelopes and their nested workflow are
 * shallow copies. All other fields are copied unchanged.
 */
// fallow-ignore-next-line complexity
export function retireEnhancedTaskEnvelope(envelope: unknown): Record<string, unknown> | null {
  if (!isRecord(envelope)) return null;

  const next: Record<string, unknown> = { ...envelope };
  let changed = false;

  if (retireEnhancedScalarMode(next.conversationMode) !== null) {
    next.conversationMode = 'code';
    changed = true;
  }

  const workflow = remapWorkflow(next.handoffWorkflow);
  if (workflow) {
    next.handoffWorkflow = workflow;
    changed = true;
  }

  return changed ? next : null;
}
