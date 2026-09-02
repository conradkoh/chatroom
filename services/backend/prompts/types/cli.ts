/**
 * Types for CLI command generators.
 *
 * Command generators accept parameters with optional values.
 * When a value is not provided, a placeholder like <chatroom-id> is used.
 */

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
// handoff command types
// ============================================================================

export interface HandoffParams extends CommandContext {
  chatroomId?: string | undefined;
  role?: string | undefined;
  nextRole?: string | undefined;
  /** Placeholder text inside the heredoc body (default: [Your message here]). */
  messagePlaceholder?: string | undefined;
}

// ============================================================================
// get-next-task command types
// ============================================================================

export interface GetNextTaskParams extends CommandContext {
  chatroomId?: string | undefined;
  role?: string | undefined;
}

/** @deprecated Use GetNextTaskParams instead */
export type WaitForTaskParams = GetNextTaskParams;

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
  /** Override the default question/simple-task handoff target (default: 'user') */
  questionTarget?: string | undefined;
  /**
   * Override the handoff target after code changes (default: 'planner').
   */
  codeChangesTarget?: string | undefined;
  /** True when harness uses native task injection instead of get-next-task */
  nativeIntegration?: boolean | undefined;
}

/**
 * Parameters for planner guidance generation
 */
export interface PlannerGuidanceParams extends BasePromptParams {
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
  /** Chatroom ID for generating exact CLI commands */
  chatroomId?: string | undefined;
  /** True when harness uses native task injection instead of get-next-task */
  nativeIntegration?: boolean | undefined;
  /** When true, static planner guidance includes enhancer workflow references. */
  plannerEnhancerActive?: boolean | undefined;
}

/**
 * Parameters for context-gaining guidance
 */
export interface ContextGainingParams extends BasePromptParams {
  chatroomId: string;
  role: string;
  /** When set, the register-agent command uses this fixed type; 'unset' produces `<remote|custom>` placeholder */
  agentType: 'remote' | 'custom' | 'unset';
}
