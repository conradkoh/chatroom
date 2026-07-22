import { runCommandOrThrow } from './run-command.js';
import { shortCommit } from '../shared/commits.js';

export { shortCommit };

export const UPDATE_REMOTE_REF = 'origin/master';

export type RepoUpdateCheck = {
  localCommit: string;
  remoteCommit: string;
  updateAvailable: boolean;
};

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  return runCommandOrThrow(repoRoot, 'git', args);
}

export async function getLocalCommit(repoRoot: string): Promise<string> {
  return runGit(repoRoot, ['rev-parse', 'HEAD']);
}

export async function fetchRemoteMaster(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['fetch', 'origin', 'master']);
}

export async function getRemoteCommit(repoRoot: string): Promise<string> {
  return runGit(repoRoot, ['rev-parse', UPDATE_REMOTE_REF]);
}

export async function checkRepoUpdate(repoRoot: string): Promise<RepoUpdateCheck> {
  const localCommit = await getLocalCommit(repoRoot);
  await fetchRemoteMaster(repoRoot);
  const remoteCommit = await getRemoteCommit(repoRoot);

  return {
    localCommit,
    remoteCommit,
    updateAvailable: localCommit !== remoteCommit,
  };
}

export async function pullAndInstall(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['pull', 'origin', 'master']);
  await runCommandOrThrow(repoRoot, 'pnpm', ['install']);
}
