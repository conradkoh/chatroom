/**
 * Prompt Section Types
 *
 * Foundational types for the prompt engineering architecture.
 * See docs/prompt-engineering/design.md for the full design.
 */

/**
 * The three-dimensional context that determines which prompt sections to include.
 *
 * Every prompt section is selected based on these dimensions:
 * - role: what the agent does (builder, reviewer, planner)
 * - team: how the team is structured (pair, squad, custom)
 * - workflow: what the team is doing (new_feature, question, follow_up)
 */
export interface SelectorContext {
  /** Agent role (e.g., 'builder', 'reviewer', 'planner') */
  role: string;
  /** Team type (e.g., 'pair', 'squad', or custom team name) */
  team: 'pair' | 'squad' | 'unknown';
  /** Current workflow/classification (e.g., 'new_feature', 'question', 'follow_up') */
  workflow?: 'new_feature' | 'question' | 'follow_up' | null;
  /** Team roles as configured */
  teamRoles: string[];
  /** Currently available (waiting) team members */
  availableMembers?: string[];
  /** Whether this role is the team's entry point */
  isEntryPoint: boolean;
  /** Convex URL for CLI command generation */
  convexUrl: string;
  /** Chatroom ID for CLI command generation */
  chatroomId?: string;
}

/**
 * A standalone prompt section with metadata.
 *
 * Each section is self-contained and composable. Delivery layers
 * select which sections to include based on the SelectorContext.
 */
export interface PromptSection {
  /** Unique identifier for this section */
  id: SectionId;
  /** Whether this is knowledge (understanding) or guidance (action) */
  type: 'knowledge' | 'guidance';
  /** The prompt content */
  content: string;
}

/**
 * Known section identifiers.
 *
 * Used to track which sections exist and where they're included.
 * New sections should be added here as they're created.
 */
export type SectionId =
  // Role Identity
  | 'team-header'
  | 'role-title'
  | 'role-description'
  // Getting Started
  | 'getting-started'
  // Classification
  | 'classification-guide'
  | 'handoff-recipient-guide'
  // Team Context
  | 'team-context'
  // Role Workflow
  | 'role-guidance'
  // Task Context (dynamic)
  | 'current-classification'
  // Handoff
  | 'handoff-options'
  | 'handoff-restriction'
  // Commands
  | 'command-handoff'
  | 'command-report-progress'
  | 'command-wait-for-task'
  | 'commands-reference'
  // Actions (task delivery)
  | 'available-actions'
  // Task-Started Reminders
  | 'task-started-reminder'
  // Policies
  | 'review-policies'
  // Next Step
  | 'next-step'
  // Wait-for-task
  | 'wait-for-task-reminder';

/**
 * Helper to create a PromptSection with type safety.
 */
export function createSection(
  id: SectionId,
  type: 'knowledge' | 'guidance',
  content: string
): PromptSection {
  return { id, type, content };
}

/**
 * Compose multiple sections into a single prompt string.
 * Filters out empty sections and joins with double newlines.
 */
export function composeSections(sections: PromptSection[]): string {
  return sections
    .filter((s) => s.content.trim())
    .map((s) => s.content)
    .join('\n\n')
    .trim();
}
