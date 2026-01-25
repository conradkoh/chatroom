/**
 * Command generator for task-started CLI command.
 *
 * Single source of truth for all task-started command examples and actual commands.
 * Now uses stdin with ---PARAM--- delimiters for new_feature classification.
 */

import type { TaskStartedParams } from '../../../types/cli.js';

/**
 * Generate a task-started command string.
 * For new_feature classification, uses stdin with structured format.
 *
 * @example
 * // Command with placeholders
 * taskStartedCommand({ cliEnvPrefix: '' })
 * // → "chatroom task-started <chatroom-id> --role=<role> --task-id=<task-id> --origin-message-classification=<question|new_feature|follow_up>"
 *
 * @example
 * // Command for question classification
 * taskStartedCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   taskId: 'task456',
 *   classification: 'question'
 * })
 * // → "chatroom task-started abc123 --role=builder --task-id=task456 --origin-message-classification=question"
 *
 * @example
 * // Command for new_feature classification (uses stdin)
 * taskStartedCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   taskId: 'task456',
 *   classification: 'new_feature'
 * })
 * // → "chatroom task-started abc123 --role=builder --task-id=task456 --origin-message-classification=new_feature << 'EOF'\n---TITLE---\n[Feature title]\n---DESCRIPTION---\n[Feature description]\n---TECH_SPECS---\n[Technical specifications]\nEOF"
 */
export function taskStartedCommand(params: TaskStartedParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const taskId = params.taskId || '<task-id>';
  const classification = params.classification || '<question|new_feature|follow_up>';

  const baseCmd = `${prefix}chatroom task-started ${chatroomId} --role=${role} --task-id=${taskId} --origin-message-classification=${classification}`;

  // For new_feature, use stdin with structured format
  if (params.classification === 'new_feature' || classification === 'new_feature') {
    const title = params.title || '[Feature title]';
    const description = params.description || '[Feature description]';
    const techSpecs = params.techSpecs || '[Technical specifications]';

    return `${baseCmd} << 'EOF'
---TITLE---
${title}
---DESCRIPTION---
${description}
---TECH_SPECS---
${techSpecs}
EOF`;
  }

  return baseCmd;
}
