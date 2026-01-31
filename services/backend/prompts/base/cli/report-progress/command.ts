/**
 * Command generator for report-progress CLI command.
 *
 * Single source of truth for all report-progress command examples and actual commands.
 * Uses stdin (EOF format) for message content, consistent with handoff command.
 */

import type { ReportProgressParams } from '../../../types/cli.js';

/**
 * Generate a report-progress command string using stdin.
 * Returns a bash command that uses HERE document for message input.
 *
 * @example
 * // Command with placeholders
 * reportProgressCommand({ cliEnvPrefix: '' })
 * // → "chatroom report-progress --chatroom-id=<chatroom-id> --role=<role> << 'EOF'\n[Your progress message here]\nEOF"
 *
 * @example
 * // Command with real values
 * reportProgressCommand({
 *   chatroomId: 'abc123',
 *   role: 'builder',
 * })
 * // → "chatroom report-progress --chatroom-id=abc123 --role=builder << 'EOF'\n[Your progress message here]\nEOF"
 */
export function reportProgressCommand(params: ReportProgressParams): string {
  const prefix = params.cliEnvPrefix || '';
  const chatroomId = params.chatroomId || '<chatroom-id>';
  const role = params.role || '<role>';

  // Modern approach: stdin using HERE document (consistent with handoff)
  return `${prefix}chatroom report-progress --chatroom-id=${chatroomId} --role=${role} << 'EOF'\n[Your progress message here]\nEOF`;
}
