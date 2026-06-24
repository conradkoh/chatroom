/**
 * Prompt Section Types
 *
 * Foundational types for the prompt engineering architecture.
 * See docs/prompt-engineering/design.md for the full design.
 */

import type { Team } from '../../src/domain/entities/team';
import type { TeamKind } from '../../src/domain/entities/team-kind';

/**
 * The three-dimensional context that determines which prompt sections to include.
 *
 * Every prompt section is selected based on these dimensions:
 * - role: what the agent does (builder, planner)
 * - team: how the team is structured (duo, solo, or custom)
 * - workflow: what the team is doing (new_feature, question, follow_up)
 */
export interface SelectorContext {
  /** Agent role (e.g., 'builder', 'planner') */
  role: string;
  /** Team type (e.g., 'duo', 'solo', or custom team name) */
  team: TeamKind | 'unknown';
  /**
   * Full team configuration entity.
   * Available when the chatroom has a valid team configuration.
   * Provides typed access to team roles, entry point, and display name
   * without needing to read individual teamId/teamRoles/teamEntryPoint fields.
   */
  teamConfig?: Team;
  /** Current workflow/classification (e.g., 'new_feature', 'question', 'follow_up') */
  workflow?: 'new_feature' | 'question' | 'follow_up' | null;
  /** Team roles as configured */
  teamRoles: string[];
  /** Whether this role is the team's entry point */
  isEntryPoint: boolean;
  /** Convex URL for CLI command generation */
  convexUrl: string;
  /** Chatroom ID for CLI command generation */
  chatroomId?: string;
  /** Agent type for register-agent command — 'unset' produces `<remote|custom>` placeholder */
  agentType: 'remote' | 'custom' | 'unset';
  /** True when harness uses native task injection (no listen loop) */
  nativeIntegration?: boolean;
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
  | 'getting-started-native'
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
  | 'handoff-templates-preview'
  | 'handoff-templates-native-builder'
  // Commands
  | 'command-handoff'
  | 'command-report-progress'
  | 'command-get-next-task'
  | 'commands-reference'
  | 'commands-reference-native'
  // Actions (task delivery)
  | 'available-actions'
  // Policies
  | 'review-policies'
  // Next Step
  | 'next-step'
  | 'next-step-native'
  // Get-next-task reminder
  | 'get-next-task-reminder'
  // Glossary
  | 'glossary'
  // Session model
  | 'session-vs-chatroom-task'
  | 'session-vs-chatroom-task-native';

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
