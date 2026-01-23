/**
 * Types for CLI command generators.
 *
 * Command generators use discriminated unions to provide type-safe generation
 * for both examples (with placeholders) and commands (with real values).
 */

/**
 * Classification types for task-started command
 */
export type MessageClassification = 'question' | 'new_feature' | 'follow_up';

/**
 * Base context shared by all command params
 */
export interface CommandContext {
  /** Optional CLI environment prefix (e.g., for env vars) */
  cliEnvPrefix?: string;
}

// ============================================================================
// task-started command types
// ============================================================================

/**
 * Example params - generates command with placeholders
 */
export interface TaskStartedExampleParams extends CommandContext {
  type: 'example';
  /** Optional: pre-fill specific classification */
  classification?: MessageClassification;
}

/**
 * Command params - generates command with real values
 */
export interface TaskStartedCommandParams extends CommandContext {
  type: 'command';
  chatroomId: string;
  role: string;
  taskId: string;
  classification: MessageClassification;
  /** Required for new_feature classification */
  title?: string;
  description?: string;
  techSpecs?: string;
}

export type TaskStartedParams = TaskStartedExampleParams | TaskStartedCommandParams;

// ============================================================================
// handoff command types
// ============================================================================

export interface HandoffExampleParams extends CommandContext {
  type: 'example';
}

export interface HandoffCommandParams extends CommandContext {
  type: 'command';
  chatroomId: string;
  role: string;
  nextRole: string;
  messageFile?: string;
}

export type HandoffParams = HandoffExampleParams | HandoffCommandParams;

// ============================================================================
// wait-for-task command types
// ============================================================================

export interface WaitForTaskExampleParams extends CommandContext {
  type: 'example';
}

export interface WaitForTaskCommandParams extends CommandContext {
  type: 'command';
  chatroomId: string;
  role: string;
}

export type WaitForTaskParams = WaitForTaskExampleParams | WaitForTaskCommandParams;
