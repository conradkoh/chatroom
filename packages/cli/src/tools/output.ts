/**
 * Tool Output Helpers — .chatroom/ temp directory management.
 *
 * Provides utilities for tools to write output files into a
 * `.chatroom/` directory under the working directory. The directory
 * is automatically created and added to `.gitignore`.
 */

import { join } from 'node:path';

// ─── Dependency Interfaces ──────────────────────────────────────────────────

/** File system operations needed by the output helpers. */
export interface OutputFsOps {
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  appendFile: (path: string, content: string) => Promise<void>;
  access: (path: string) => Promise<void>;
}

/** All external dependencies for output helpers. */
export interface OutputDeps {
  fs: OutputFsOps;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Name of the temp directory used by CLI tools. */
const CHATROOM_DIR = '.chatroom';

/**
 * Ignore rules written into a project's `.gitignore`. The first line keeps the
 * whole directory out of git; the negation re-includes agent definitions, which
 * are meant to be committed and shared with the team.
 */
const CHATROOM_GITIGNORE_LINES = ['.chatroom/*', '!.chatroom/agents/'] as const;

/** The pre-agent rule. Still honoured so an existing `.gitignore` is never rewritten. */
const LEGACY_CHATROOM_IGNORE_LINES = ['.chatroom', '.chatroom/'] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the `.chatroom/` directory path for a given working directory.
 */
export function resolveChatroomDir(workingDir: string): string {
  return join(workingDir, CHATROOM_DIR);
}

/**
 * Ensure the `.chatroom/` directory exists under the given working directory.
 * Creates it recursively if it doesn't exist.
 */
export async function ensureChatroomDir(deps: OutputDeps, workingDir: string): Promise<string> {
  const dir = resolveChatroomDir(workingDir);
  await deps.fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Ensure `.chatroom/` is ignored in the working directory's `.gitignore` while
 * keeping `.chatroom/agents/` committable.
 *
 * Appends both rules when the file is missing or carries neither the current
 * pair nor the legacy bare `.chatroom` rule. A legacy file is left untouched:
 * the user's existing lines are never rewritten.
 */
export async function ensureGitignore(deps: OutputDeps, workingDir: string): Promise<void> {
  const gitignorePath = join(workingDir, '.gitignore');

  let content = '';
  try {
    content = await deps.fs.readFile(gitignorePath, 'utf8');
  } catch {
    // File doesn't exist — will create it
  }

  const lines = content.split('\n').map((line) => line.trim());
  if (hasChatroomIgnoreRules(lines)) return;

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await deps.fs.appendFile(gitignorePath, `${separator}${CHATROOM_GITIGNORE_LINES.join('\n')}\n`);
}

/** True when the file already carries the current pair or the legacy bare rule. */
function hasChatroomIgnoreRules(lines: readonly string[]): boolean {
  return (
    CHATROOM_GITIGNORE_LINES.every((line) => lines.includes(line)) ||
    LEGACY_CHATROOM_IGNORE_LINES.some((line) => lines.includes(line))
  );
}

/**
 * Format a timestamp for use in output filenames.
 * Format: `YYYYMMDD-HHmmss-SSS`
 */
export function formatOutputTimestamp(date: Date = new Date()): string {
  const yyyy = date.getFullYear().toString();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const hh = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  const ss = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}-${ms}`;
}

/**
 * Generate a timestamped output file path within the `.chatroom/` directory.
 *
 * @param workingDir - The working directory containing `.chatroom/`
 * @param toolName   - Name of the tool (e.g., 'parse-pdf')
 * @param extension  - File extension without the dot (e.g., 'txt')
 * @param date       - Optional date for testing; defaults to now
 * @returns Absolute path like `<workingDir>/.chatroom/parse-pdf-20260330-163000-123.txt`
 */
export function generateOutputPath(
  workingDir: string,
  toolName: string,
  extension: string,
  date?: Date
): string {
  const timestamp = formatOutputTimestamp(date);
  const filename = `${toolName}-${timestamp}.${extension}`;
  return join(resolveChatroomDir(workingDir), filename);
}
