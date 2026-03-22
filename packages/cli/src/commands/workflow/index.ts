/**
 * Workflow commands for managing structured DAG-based workflows.
 */

import type { WorkflowDeps } from './deps.js';
import { api, type Id } from '../../api.js';
import { getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient, getConvexUrl } from '../../infrastructure/convex/client.js';

// ─── Re-exports ────────────────────────────────────────────────────────────

export type { WorkflowDeps } from './deps.js';

// ─── Types ─────────────────────────────────────────────────────────────────

type WorkflowStatus = 'draft' | 'active' | 'completed' | 'cancelled';
type StepStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

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

export interface StepCancelOptions {
  role: string;
  workflowKey: string;
  stepKey: string;
  reason: string;
}

export interface ExitWorkflowOptions {
  role: string;
  workflowKey: string;
  reason: string;
}

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
      getOtherSessionUrls: () => [],
    },
  };
}

// ─── Auth Helper ───────────────────────────────────────────────────────────

function requireAuth(d: WorkflowDeps): string {
  const sessionId = d.session.getSessionId();
  if (!sessionId) {
    console.error(`❌ Not authenticated. Please run: chatroom auth login`);
    process.exit(1);
  }
  return sessionId as string;
}

function validateChatroomId(chatroomId: string): void {
  if (
    !chatroomId ||
    typeof chatroomId !== 'string' ||
    chatroomId.length < 20 ||
    chatroomId.length > 40
  ) {
    console.error(
      `❌ Invalid chatroom ID format: ID must be 20-40 characters (got ${chatroomId?.length || 0})`
    );
    process.exit(1);
  }
}

// ─── Section Parser ────────────────────────────────────────────────────────

/**
 * Parse multi-section stdin content with markers like ---GOAL---, ---REQUIREMENTS---, ---WARNINGS---
 */
function parseSections(
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
  const markers: Array<{ section: string; index: number; matchStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    const sectionName = match[1]!.replace(/^---/, '').replace(/---$/, '');
    markers.push({ section: sectionName, index: match.index + match[0].length, matchStart: match.index });
  }

  // Extract content between markers
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index;
    const end = i + 1 < markers.length ? markers[i + 1]!.matchStart : input.length;
    const content = input.substring(start, end).trim();
    result.set(markers[i]!.section, content);
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
        console.error(`   [${s.toLowerCase()} content here${isRequired ? ' (required)' : ' (optional)'}]`);
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

// ─── Commands ──────────────────────────────────────────────────────────────

/**
 * Create a new workflow with steps from JSON stdin.
 */
export async function createWorkflow(
  chatroomId: string,
  options: CreateWorkflowOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Parse JSON from stdin
  let stepsData: {
    steps: Array<{
      stepKey: string;
      description: string;
      dependsOn: string[];
      order: number;
    }>;
  };

  try {
    stepsData = JSON.parse(options.stdinContent);
  } catch {
    console.error('❌ Invalid JSON input. Expected format:');
    console.error(
      '   { "steps": [{ "stepKey": "...", "description": "...", "dependsOn": [...], "order": N }] }'
    );
    process.exit(1);
    return;
  }

  // Validate structure
  if (!stepsData.steps || !Array.isArray(stepsData.steps)) {
    console.error('❌ JSON must contain a "steps" array');
    process.exit(1);
    return;
  }

  if (stepsData.steps.length === 0) {
    console.error('❌ Workflow must have at least one step');
    process.exit(1);
    return;
  }

  // Validate each step has required fields
  for (const step of stepsData.steps) {
    if (!step.stepKey || typeof step.stepKey !== 'string') {
      console.error('❌ Each step must have a "stepKey" (string)');
      process.exit(1);
      return;
    }
    if (!step.description || typeof step.description !== 'string') {
      console.error(`❌ Step "${step.stepKey}" must have a "description" (string)`);
      process.exit(1);
      return;
    }
    if (!Array.isArray(step.dependsOn)) {
      console.error(`❌ Step "${step.stepKey}" must have a "dependsOn" (array of strings)`);
      process.exit(1);
      return;
    }
    if (typeof step.order !== 'number') {
      console.error(`❌ Step "${step.stepKey}" must have an "order" (number)`);
      process.exit(1);
      return;
    }
  }

  try {
    const result = await d.backend.mutation(api.workflows.createWorkflow, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      workflowKey: options.workflowKey,
      steps: stepsData.steps,
      createdBy: options.role,
    });

    console.log('');
    console.log('✅ Workflow created');
    console.log(`   Key: ${options.workflowKey}`);
    console.log(`   Workflow ID: ${result.workflowId}`);
    console.log(`   Steps: ${stepsData.steps.length}`);
    console.log(`   Status: draft`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to create workflow: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
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
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Parse sections from stdin
  const sections = parseSections(
    options.stdinContent,
    ['GOAL', 'REQUIREMENTS'],
    ['WARNINGS']
  );

  const goal = sections.get('GOAL')!;
  const requirements = sections.get('REQUIREMENTS')!;
  const warnings = sections.get('WARNINGS') || undefined;

  try {
    await d.backend.mutation(api.workflows.specifyStep, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      workflowKey: options.workflowKey,
      stepKey: options.stepKey,
      assigneeRole: options.assigneeRole,
      goal,
      requirements,
      warnings,
    });

    console.log('');
    console.log('✅ Step specified');
    console.log(`   Workflow: ${options.workflowKey}`);
    console.log(`   Step: ${options.stepKey}`);
    console.log(`   Assignee: ${options.assigneeRole}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to specify step: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
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
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  try {
    await d.backend.mutation(api.workflows.executeWorkflow, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      workflowKey: options.workflowKey,
    });

    console.log('');
    console.log('✅ Workflow activated');
    console.log(`   Key: ${options.workflowKey}`);
    console.log(`   Status: active`);
    console.log('');
    console.log('💡 Root steps (no dependencies) are now in_progress.');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to execute workflow: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
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
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  try {
    const result = await d.backend.query(api.workflows.getWorkflowStatus, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      workflowKey: options.workflowKey,
    });

    const wf = result.workflow;

    console.log('');
    console.log('══════════════════════════════════════════════════');
    console.log(`${getWorkflowStatusEmoji(wf.status as WorkflowStatus)} WORKFLOW: ${wf.workflowKey}`);
    console.log('══════════════════════════════════════════════════');
    console.log(`Status: ${wf.status.toUpperCase()}`);
    console.log(`Created by: ${wf.createdBy}`);

    const createdDate = new Date(wf.createdAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    console.log(`Created: ${createdDate}`);

    if (wf.completedAt) {
      const completedDate = new Date(wf.completedAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      console.log(`Completed: ${completedDate}`);
    }

    if (wf.cancelledAt) {
      const cancelledDate = new Date(wf.cancelledAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      console.log(`Cancelled: ${cancelledDate}`);
      if (wf.cancelReason) {
        console.log(`Reason: ${wf.cancelReason}`);
      }
    }

    console.log('');
    console.log('──────────────────────────────────────────────────');
    console.log('📋 STEPS');
    console.log('──────────────────────────────────────────────────');

    if (result.steps.length === 0) {
      console.log('No steps.');
    } else {
      for (const step of result.steps) {
        const emoji = getStepStatusEmoji(step.status as StepStatus);
        console.log(`${emoji} [${step.status.toUpperCase()}] ${step.stepKey}: ${step.description}`);

        const details: string[] = [];
        if (step.assigneeRole) details.push(`assignee=${step.assigneeRole}`);
        if (step.dependsOn.length > 0) details.push(`depends_on=[${step.dependsOn.join(', ')}]`);
        details.push(`order=${step.order}`);

        console.log(`   ${details.join(' | ')}`);

        if (step.cancelReason) {
          console.log(`   Cancel reason: ${step.cancelReason}`);
        }

        console.log('');
      }
    }

    // Available next steps
    if (result.availableNextSteps.length > 0) {
      console.log('──────────────────────────────────────────────────');
      console.log('🔜 AVAILABLE NEXT STEPS');
      console.log('──────────────────────────────────────────────────');
      for (const stepKey of result.availableNextSteps) {
        const step = result.steps.find((s: { stepKey: string; description: string }) => s.stepKey === stepKey);
        if (step) {
          console.log(`   → ${stepKey}: ${step.description}`);
        }
      }
      console.log('');
    }

    console.log('══════════════════════════════════════════════════');
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to get workflow status: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
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
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  try {
    await d.backend.mutation(api.workflows.completeStep, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      workflowKey: options.workflowKey,
      stepKey: options.stepKey,
    });

    console.log('');
    console.log('✅ Step completed');
    console.log(`   Workflow: ${options.workflowKey}`);
    console.log(`   Step: ${options.stepKey}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to complete step: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
}

/**
 * Cancel a workflow step with a required reason.
 */
export async function cancelStep(
  chatroomId: string,
  options: StepCancelOptions,
  deps?: WorkflowDeps
): Promise<void> {
  const d = deps ?? (await createDefaultDeps());
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate reason is non-empty
  if (!options.reason || options.reason.trim().length === 0) {
    console.error('❌ Reason is required when cancelling a step');
    process.exit(1);
    return;
  }

  try {
    await d.backend.mutation(api.workflows.cancelStep, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      workflowKey: options.workflowKey,
      stepKey: options.stepKey,
      reason: options.reason.trim(),
    });

    console.log('');
    console.log('❌ Step cancelled');
    console.log(`   Workflow: ${options.workflowKey}`);
    console.log(`   Step: ${options.stepKey}`);
    console.log(`   Reason: ${options.reason.trim()}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to cancel step: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
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
  const sessionId = requireAuth(d);
  validateChatroomId(chatroomId);

  // Validate reason is non-empty
  if (!options.reason || options.reason.trim().length === 0) {
    console.error('❌ Reason is required when exiting a workflow');
    process.exit(1);
    return;
  }

  try {
    await d.backend.mutation(api.workflows.exitWorkflow, {
      sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      workflowKey: options.workflowKey,
      reason: options.reason.trim(),
    });

    console.log('');
    console.log('❌ Workflow exited (cancelled)');
    console.log(`   Key: ${options.workflowKey}`);
    console.log(`   Reason: ${options.reason.trim()}`);
    console.log('');
  } catch (error) {
    console.error(`❌ Failed to exit workflow: ${(error as Error).message}`);
    process.exit(1);
    return;
  }
}
