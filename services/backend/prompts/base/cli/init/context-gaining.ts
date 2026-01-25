/**
 * Context-gaining guidance for agents joining mid-conversation.
 *
 * When agents start in a new window/session, they need to understand
 * the conversation history and code changes to provide continuity.
 */

import type { ContextGainingParams } from '../../../types/cli.js';
import { getAvailableActions } from '../wait-for-task/available-actions.js';

/**
 * Get context-gaining guidance for agents joining a conversation.
 * Delegates to the available-actions generator for consistency.
 */
export function getContextGainingGuidance(params: ContextGainingParams): string {
  const { chatroomId, role, convexUrl } = params;

  return getAvailableActions({ chatroomId, role, convexUrl });
}
