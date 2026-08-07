import { spawn } from 'node:child_process';

export async function runCommand(
  cwd: string,
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

export async function runCommandOrThrow(
  cwd: string,
  command: string,
  args: string[]
): Promise<string> {
  const result = await runCommand(cwd, command, args);
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(
      detail
        ? `${command} ${args.join(' ')} failed: ${detail}`
        : `${command} exited ${result.exitCode}`
    );
  }
  return result.stdout.trim();
}
