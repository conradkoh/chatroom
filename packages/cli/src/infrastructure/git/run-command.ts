import { spawn } from 'node:child_process';

const DEFAULT_GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  NO_COLOR: '1',
};

export type CommandResult =
  | { stdout: string; stderr: string }
  | { error: Error & { code?: number } };

function runCommandSpawn(
  command: string,
  args: string[],
  cwd: string,
  options?: {
    timeout?: number;
    maxBuffer?: number;
    env?: NodeJS.ProcessEnv;
    successExitCodes?: number[];
  }
): Promise<CommandResult> {
  const successExitCodes = options?.successExitCodes ?? [0];
  // fallow-ignore-next-line complexity
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: options?.env ?? DEFAULT_GIT_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024;

    const onData = (chunk: Buffer, target: 'stdout' | 'stderr') => {
      const str = chunk.toString();
      if (target === 'stdout') stdout += str;
      else stderr += str;
      if (stdout.length + stderr.length > maxBuffer) {
        child.kill('SIGTERM');
      }
    };

    child.stdout?.on('data', (c) => onData(c, 'stdout'));
    child.stderr?.on('data', (c) => onData(c, 'stderr'));

    const timer = options?.timeout
      ? setTimeout(() => child.kill('SIGTERM'), options.timeout)
      : undefined;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (successExitCodes.includes(code ?? -1)) resolve({ stdout, stderr });
      else {
        resolve({
          error: Object.assign(new Error(stderr || stdout || `exit ${code}`), {
            code: code ?? undefined,
          }),
        });
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ error: err });
    });
  });
}

export function runGit(
  args: string[],
  cwd: string,
  options?: { timeout?: number; maxBuffer?: number; successExitCodes?: number[] }
): Promise<CommandResult> {
  return runCommandSpawn('git', args, cwd, options);
}

export function runGh(
  args: string[],
  cwd: string,
  options?: { timeout?: number }
): Promise<CommandResult> {
  return runCommandSpawn('gh', args, cwd, {
    timeout: options?.timeout,
    env: { ...process.env, NO_COLOR: '1' },
  });
}
