import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { runCommandOrThrow } from './run-command.js';
import { isRemoteVersionNewer } from '../shared/semver.js';

export const UPDATE_REMOTE_REF = 'origin/master';

export type RepoUpdateCheck = {
  localVersion: string;
  remoteVersion: string;
  updateAvailable: boolean;
};

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  return runCommandOrThrow(repoRoot, 'git', args);
}

function readVersionFromPackageJson(raw: string, source: string): string {
  const pkg = JSON.parse(raw) as { version?: string };
  if (!pkg.version) {
    throw new Error(`${source} package.json is missing a version field`);
  }
  return pkg.version;
}

export async function getLocalVersion(repoRoot: string): Promise<string> {
  const raw = await readFile(join(repoRoot, 'package.json'), 'utf8');
  return readVersionFromPackageJson(raw, 'Root');
}

export async function fetchRemoteMaster(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['fetch', 'origin', 'master']);
}

export async function getRemoteVersion(repoRoot: string): Promise<string> {
  const raw = await runGit(repoRoot, ['show', `${UPDATE_REMOTE_REF}:package.json`]);
  return readVersionFromPackageJson(raw, 'Remote');
}

export async function checkRepoUpdate(repoRoot: string): Promise<RepoUpdateCheck> {
  const localVersion = await getLocalVersion(repoRoot);
  await fetchRemoteMaster(repoRoot);
  const remoteVersion = await getRemoteVersion(repoRoot);

  return {
    localVersion,
    remoteVersion,
    updateAvailable: isRemoteVersionNewer(localVersion, remoteVersion),
  };
}

export async function pullAndInstall(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['pull', 'origin', 'master']);
  await runCommandOrThrow(repoRoot, 'pnpm', ['install']);
}
