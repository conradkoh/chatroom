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
 * Base interface for all prompt parameters that involve CLI command generation.
 * Ensures convexUrl is always provided for proper environment variable prefix handling.
 */
export interface BasePromptParams {
  /** Required Convex URL for generating correct environment variable prefix */
  convexUrl: string;
}

/**
 * Base context shared by all command params.
 * cliEnvPrefix is required to ensure commands work correctly in all environments.
 */
export interface CommandContext {
  /** CLI environment prefix for non-production environments (empty string for production) */
  cliEnvPrefix: string;
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
}

// ============================================================================
// wait-for-task command types
// ============================================================================

export interface WaitForTaskParams extends CommandContext {
  chatroomId?: string;
  role?: string;
}

// ============================================================================
// report-progress command types
// ============================================================================

export interface ReportProgressParams extends CommandContext {
  chatroomId?: string;
  role?: string;
  // message field removed - now uses stdin (EOF format) for all input
}

// ============================================================================
// Role guidance parameter types
// ============================================================================

/**
 * Parameters for builder guidance generation
 */
export interface BuilderGuidanceParams extends BasePromptParams {
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
}

/**
 * Parameters for reviewer guidance generation
 */
export interface ReviewerGuidanceParams extends BasePromptParams {
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
}

/**
 * Parameters for context-gaining guidance
 */
export interface ContextGainingParams extends BasePromptParams {
  chatroomId: string;
  role: string;
}
