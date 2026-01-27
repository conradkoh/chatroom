/**
 * Shared formatters for prompt generation
 */

/**
 * Format handoff message for CLI
 */
export function formatHandoffMessage(content: string): string {
  return content.trim();
}

/**
 * Format task ID for display
 */
export function formatTaskId(taskId: string): string {
  return taskId.slice(0, 8) + '...';
}
