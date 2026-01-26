/**
 * Command generator for report-progress CLI command.
 *
 * Single source of truth for all report-progress command examples and actual commands.
 */

import type { ReportProgressParams } from '../../../types/cli.js';

/**
 * Generate a report-progress command string.
 * Accepts optional values and uses placeholders for any missing values.
 *
 * @example
 * // Command with placeholders
 * reportProgressCommand({ cliEnvPrefix: '' })
 * // → "chatroom report-progress --chatroom-id=<chatroom-id> --role=<role> --message=\"<status message>\""
 *
 * @example
 * // Command with real values
 * reportProgressCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 *   message: 'Running tests...'
 * })
 * // → "chatroom report-progress --chatroom-id=abc123 --role=builder --message=\"Running tests...\""
 */
export function reportProgressCommand(params: ReportProgressParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';
  const message = params.message || '<status message>';

  return `${prefix}chatroom report-progress --chatroom-id=${chatroomId} --role=${role} --message="${message}"`;
}
