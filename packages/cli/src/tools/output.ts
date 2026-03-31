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
export async function ensureChatroomDir(
  deps: OutputDeps,
  workingDir: string
): Promise<string> {
  const dir = resolveChatroomDir(workingDir);
  await deps.fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Ensure `.chatroom/` is listed in the working directory's `.gitignore`.
 * Appends the entry if the file doesn't exist or doesn't already include it.
 */
export async function ensureGitignore(
  deps: OutputDeps,
  workingDir: string
): Promise<void> {
  const gitignorePath = join(workingDir, '.gitignore');
  const entry = CHATROOM_DIR;

  let content = '';
  try {
    content = await deps.fs.readFile(gitignorePath, 'utf8');
  } catch {
    // File doesn't exist — will create it
  }

  // Check if .chatroom is already listed (as a whole line)
  const lines = content.split('\n');
  const alreadyIgnored = lines.some(
    (line) => line.trim() === entry || line.trim() === `${entry}/`
  );

  if (!alreadyIgnored) {
    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    await deps.fs.appendFile(gitignorePath, `${separator}${entry}\n`);
  }
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
