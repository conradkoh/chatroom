/**
 * Runs `git clone` for a `daemon.gitClone` command.
 *
 * Safety rules:
 * - The URL is re-validated here even though the backend validated it.
 * - The target must be missing or an empty directory. Nothing is ever deleted, including on failure.
 * - No shell is used, and `--` separates options from the URL.
 * - `GIT_ALLOW_PROTOCOL` limits transports (blocks ext::, fd::, file) unless a caller overrides it.
 */

import { spawn } from 'node:child_process';
import type { Stats } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

import {
  GIT_CLONE_ALLOWED_PROTOCOLS,
  GIT_CLONE_ERROR_MESSAGES,
  validateGitCloneUrl,
  type GitCloneErrorCode,
} from '@workspace/shared/domain/git-clone';

export interface GitCloneProgress {
  phase: string;
  percent?: number | undefined;
}

export type GitCloneOutcome =
  | { ok: true; clonedPath: string }
  | { ok: false; errorCode: GitCloneErrorCode; errorMessage: string };

export interface RunGitCloneOptions {
  repoUrl: string;
  targetPath: string;
  onProgress: (progress: GitCloneProgress) => void;
  /** Kill the clone (SIGTERM) after this long. Defaults to 30 minutes. */
  timeoutMs?: number | undefined;
  /** Test seam. Defaults to child_process.spawn. */
  spawnFn?: typeof spawn | undefined;
}

const DEFAULT_TIMEOUT_MS = 30 * 60_000;
/** Bounds memory held for git's stderr. Only the tail is needed to classify and explain a failure. */
const STDERR_TAIL_CHARS = 8 * 1024;
/** Upper bound for the failure message stored in the backend. */
const ERROR_MESSAGE_CHARS = 500;

const PROGRESS_LINE_PATTERN =
  /^(?:remote: )?(Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files):\s+(\d{1,3})%/;

/** "Receiving objects:  42% (420/1000)" → { phase: 'Receiving objects', percent: 42 }; null otherwise. */
function parseGitCloneProgressLine(line: string): GitCloneProgress | null {
  const match = PROGRESS_LINE_PATTERN.exec(line.trim());
  if (!match?.[1] || !match[2]) return null;
  return { phase: match[1], percent: Math.min(100, Number(match[2])) };
}

/** Ordered rules: the first matching pattern decides the code. Patterns match git's English output (LC_ALL=C). */
const STDERR_FAILURE_RULES: readonly { code: GitCloneErrorCode; pattern: RegExp }[] = [
  { code: 'target_not_empty', pattern: /already exists and is not an empty directory/ },
  {
    code: 'auth',
    pattern:
      /Authentication failed|could not read Username|Permission denied \(publickey|Host key verification failed|terminal prompts disabled/,
  },
  {
    code: 'repo_not_found',
    pattern: /Repository not found|not found|does not appear to be a git repository/,
  },
  {
    code: 'network',
    pattern:
      /Could not resolve host|Connection timed out|Connection refused|Network is unreachable|unable to access/,
  },
];

/** Maps git's stderr (and a spawn error code) to a shared error code. Unmatched output is `unknown`. */
function classifyGitCloneFailure(stderrTail: string, spawnErrorCode?: string): GitCloneErrorCode {
  if (spawnErrorCode === 'ENOENT') return 'git_missing';
  return STDERR_FAILURE_RULES.find((rule) => rule.pattern.test(stderrTail))?.code ?? 'unknown';
}

/** stat that treats a missing path as null. Other errors (e.g. EACCES) propagate. */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Reports whether a clone can start at `targetPath`.
 * 'ok' when the path is missing or an empty directory. 'not_empty' for a non-empty directory or a file.
 */
async function checkCloneTarget(targetPath: string): Promise<'ok' | 'not_empty'> {
  const info = await statOrNull(targetPath);
  if (!info) return 'ok';
  if (!info.isDirectory()) return 'not_empty';
  return (await readdir(targetPath)).length === 0 ? 'ok' : 'not_empty';
}

/** Strips `user:password@` from URLs so credentials never reach the backend or logs. */
function redactUrlCredentials(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}

function failureOutcome(errorCode: GitCloneErrorCode, stderrTail: string): GitCloneOutcome {
  const tail = redactUrlCredentials(stderrTail.trim()).slice(-ERROR_MESSAGE_CHARS);
  return { ok: false, errorCode, errorMessage: tail || GIT_CLONE_ERROR_MESSAGES[errorCode] };
}

/**
 * Splits git's stderr into progress lines and keeps a bounded tail for diagnostics.
 * git separates progress updates with \r, so both \r and \n end a line. A partial last line is held
 * until the next chunk (or flush) arrives.
 */
function createStderrReader(onProgress: (progress: GitCloneProgress) => void) {
  let tail = '';
  let pending = '';
  const emit = (line: string) => {
    const progress = parseGitCloneProgressLine(line);
    if (progress) onProgress(progress);
  };
  return {
    push(text: string) {
      tail = (tail + text).slice(-STDERR_TAIL_CHARS);
      const parts = (pending + text).split(/[\r\n]+/);
      pending = parts.pop() ?? '';
      parts.forEach(emit);
    },
    flush() {
      emit(pending);
      pending = '';
    },
    tail: () => tail,
  };
}

/**
 * Environment for the git child. Forces English output, blocks interactive prompts, and limits
 * transports to GIT_CLONE_ALLOWED_PROTOCOLS.
 */
function gitCloneEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: GIT_CLONE_ALLOWED_PROTOCOLS,
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
  };
}

function spawnGitClone(
  repoUrl: string,
  cloneTarget: string,
  opts: RunGitCloneOptions
): Promise<GitCloneOutcome> {
  const spawnFn = opts.spawnFn ?? spawn;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    const stderr = createStderrReader(opts.onProgress);

    const child = spawnFn('git', ['clone', '--progress', '--', repoUrl, cloneTarget], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: gitCloneEnv(),
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(failureOutcome('timeout', stderr.tail()));
    }, timeoutMs);

    const finish = (outcome: GitCloneOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => stderr.push(text));
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(failureOutcome(classifyGitCloneFailure(stderr.tail(), error.code), stderr.tail()));
    });
    child.on('close', (code: number | null) => {
      stderr.flush();
      if (code === 0) {
        finish({ ok: true, clonedPath: cloneTarget });
        return;
      }
      finish(failureOutcome(classifyGitCloneFailure(stderr.tail()), stderr.tail()));
    });
  });
}

/** Turns an unexpected exception into an `unknown` outcome so runGitClone never throws. */
async function guardUnexpected(run: () => Promise<GitCloneOutcome>): Promise<GitCloneOutcome> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errorCode: 'unknown', errorMessage: redactUrlCredentials(message) };
  }
}

function failedWith(errorCode: GitCloneErrorCode): GitCloneOutcome {
  return { ok: false, errorCode, errorMessage: GIT_CLONE_ERROR_MESSAGES[errorCode] };
}

/**
 * Clones `repoUrl` into `targetPath`. Never throws. Every failure is returned as an outcome.
 * `clonedPath` is the target with trailing slashes removed, matching the backend's normalized path.
 */
export async function runGitClone(opts: RunGitCloneOptions): Promise<GitCloneOutcome> {
  const repo = validateGitCloneUrl(opts.repoUrl);
  const cloneTarget = opts.targetPath.trim().replace(/\/+$/, '');
  if (!repo.ok || cloneTarget === '') return failedWith('invalid_request');

  return guardUnexpected(async () => {
    if ((await checkCloneTarget(cloneTarget)) === 'not_empty')
      return failedWith('target_not_empty');
    return spawnGitClone(repo.url, cloneTarget, opts);
  });
}
