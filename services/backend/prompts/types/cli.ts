/**
 * Types for CLI command generators.
 *
 * Command generators accept parameters with optional values.
 * When a value is not provided, a placeholder like <chatroom-id> is used.
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

export interface TaskStartedParams extends CommandContext {
  chatroomId?: string;
  role?: string;
  taskId?: string;
  classification?: MessageClassification;
  /** Required for new_feature classification */
  title?: string;
  description?: string;
  techSpecs?: string;
}

// ============================================================================
// handoff command types
// ============================================================================

export interface HandoffParams extends CommandContext {
  chatroomId?: string;
  role?: string;
  nextRole?: string;
  messageFile?: string;
}

// ============================================================================
// wait-for-task command types
// ============================================================================

export interface WaitForTaskParams extends CommandContext {
  chatroomId?: string;
  role?: string;
}
