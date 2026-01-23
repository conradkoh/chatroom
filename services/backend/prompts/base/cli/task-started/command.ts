/**
 * Command generator for task-started CLI command.
 *
 * Single source of truth for all task-started command examples and actual commands.
 */

import type { TaskStartedParams } from '../../../types/cli.js';

/**
 * Generate a task-started command string.
 *
 * @example
 * // Example with placeholders
 * taskStartedCommand({ type: 'example' })
 * // → "chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>"
 *
 * @example
 * // Example with specific classification
 * taskStartedCommand({ type: 'example', classification: 'new_feature' })
 * // → "chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=new_feature"
 *
 * @example
 * // Actual command with real values
 * taskStartedCommand({
 *   type: 'command',
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   taskId: 'task456',
 *   classification: 'question'
 * })
 * // → "chatroom task-started abc123 --role=builder --task-id=task456 --origin-message-classification=question"
 */
export function taskStartedCommand(params: TaskStartedParams): string {
  const prefix = params.cliEnvPrefix || '';

  if (params.type === 'example') {
    const classification = params.classification || '<question|new_feature|follow_up>';
    return `${prefix}chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=${classification}`;
  }

  // type === 'command'
  const { chatroomId, role, taskId, classification, title, description, techSpecs } = params;

  let cmd = `${prefix}chatroom task-started ${chatroomId} --role=${role} --task-id=${taskId} --origin-message-classification=${classification}`;

  // Add feature metadata for new_feature classification
  if (classification === 'new_feature') {
    if (title) cmd += ` \\\n  --title="${title}"`;
    if (description) cmd += ` \\\n  --description="${description}"`;
    if (techSpecs) cmd += ` \\\n  --tech-specs="${techSpecs}"`;
  }

  return cmd;
}
