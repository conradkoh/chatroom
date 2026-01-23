/**
 * Prompt configuration constants.
 * Single source of truth for paths and patterns used in prompts.
 */

/**
 * The base directory for handoff files (relative to working directory).
 * Uses tmp/chatroom instead of .chatroom to avoid "dot file protection"
 * which some systems have enabled to prevent agents from modifying dotfiles.
 */
export const HANDOFF_DIR = 'tmp/chatroom';

/**
 * Generates a bash snippet to create the handoff directory and a unique file path.
 * @param filePrefix - The prefix for the file (e.g., 'message', 'feedback', 'description')
 * @param varName - The variable name to use (e.g., 'MSG_FILE', 'TASK_FILE')
 * @returns Bash snippet for creating the directory and setting the file path variable
 */
export function getHandoffFileSnippet(filePrefix: string, varName = 'MSG_FILE'): string {
  return `mkdir -p ${HANDOFF_DIR}
${varName}="${HANDOFF_DIR}/${filePrefix}-$(date +%s%N).md"`;
}

/**
 * Generates a bash snippet for multiple files with a shared unique ID.
 * Useful for task-started which needs description and tech-specs files.
 * @param files - Array of { prefix, varName } for each file needed
 * @returns Bash snippet with shared UNIQUE_ID
 */
export function getMultiFileSnippet(files: { prefix: string; varName: string }[]): string {
  const lines = [`mkdir -p ${HANDOFF_DIR}`, `UNIQUE_ID=$(date +%s%N)`];
  for (const file of files) {
    lines.push(`${file.varName}="${HANDOFF_DIR}/${file.prefix}-$UNIQUE_ID.md"`);
  }
  return lines.join('\n');
}
