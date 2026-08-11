const ORIGINAL_HANDOFF_OUTPUT_DIR = '.chatroom/downloads/messages/linear/original-planner-handoff';

function quoteShellArgument(value: string): string {
  return `"${value.replace(/(["\\$`])/g, '\\$1').replace(/\r?\n/g, '\\n')}"`;
}

/**
 * Builds instructions for recovering the exact planner → enhancer handoff.
 *
 * The message anchor keeps the download scoped to the original handoff rather than
 * exposing unrelated chatroom history.
 */
export function buildOriginalHandoffRecoveryInstructions(params: {
  chatroomId: string;
  handoffMessageId?: string;
}): string {
  if (!params.handoffMessageId) {
    return '';
  }

  const command = [
    'chatroom messages download',
    `--chatroom-id=${quoteShellArgument(params.chatroomId)}`,
    '--role="planner"',
    `--since-message-id=${quoteShellArgument(params.handoffMessageId)}`,
    '--limit=1',
    `--output-dir=${quoteShellArgument(ORIGINAL_HANDOFF_OUTPUT_DIR)}`,
    '&&',
    `cat ${quoteShellArgument(`${ORIGINAL_HANDOFF_OUTPUT_DIR}/`)}*.md`,
  ].join(' ');

  return [
    '',
    '',
    '## Original Handoff',
    '',
    'Before delegating this work again, recover the original planner → enhancer handoff with:',
    '',
    '```bash',
    command,
    '```',
  ].join('\n');
}
