/**
 * Command generator for task-started CLI command.
 *
 * Single source of truth for all task-started command examples and actual commands.
 */

import type { TaskStartedParams } from '../../../types/cli.js';

/**
 * Generate a task-started command string.
 * Accepts optional values and uses placeholders for any missing values.
 *
 * @example
 * // Command with placeholders
 * taskStartedCommand({})
 * // → "chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>"
 *
 * @example
 * // Command with specific classification placeholder
 * taskStartedCommand({ classification: 'new_feature' })
 * // → "chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=new_feature"
 *
 * @example
 * // Command with real values
 * taskStartedCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   taskId: 'task456',
 *   classification: 'question'
 * })
 * // → "chatroom task-started abc123 --role=builder --task-id=task456 --origin-message-classification=question"
 */
export function taskStartedCommand(params: TaskStartedParams = {}): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const taskId = params.taskId || '<task-id>';
  const classification = params.classification || '<question|new_feature|follow_up>';

  let cmd = `${prefix}chatroom task-started ${chatroomId} --role=${role} --task-id=${taskId} --origin-message-classification=${classification}`;

  // Add feature metadata for new_feature classification
  if (params.classification === 'new_feature') {
    if (params.title) cmd += ` \\\n  --title="${params.title}"`;
    if (params.description) cmd += ` \\\n  --description="${params.description}"`;
    if (params.techSpecs) cmd += ` \\\n  --tech-specs="${params.techSpecs}"`;
  }

  return cmd;
}
