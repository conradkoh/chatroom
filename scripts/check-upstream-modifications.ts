#!/usr/bin/env bun

import { execSync } from 'node:child_process';

import { isTemplateRemote, TEMPLATE_OWNER_REPO } from './template-repo';

const ACK_ENV_VAR = 'UPSTREAM_MODIFY_ACKNOWLEDGED';
const ACK_GIT_CONFIG = 'template.allowUpstreamModifications';
const ACK_CLI_FLAG = '--allow-upstream-modifications';

type StagedChange = {
  status: string;
  paths: string[];
};

function runGit(command: string): string {
  return execSync(`git ${command}`, { encoding: 'utf8' }).trim();
}

function tryGit(command: string): string | null {
  try {
    return runGit(command);
  } catch {
    return null;
  }
}

function hasAcknowledgement(): boolean {
  if (process.argv.includes(ACK_CLI_FLAG)) {
    return true;
  }

  if (process.env[ACK_ENV_VAR] === '1') {
    return true;
  }

  return tryGit(`config --get ${ACK_GIT_CONFIG}`) === 'true';
}

function getRemoteUrl(remoteName: string): string | null {
  return tryGit(`remote get-url ${remoteName}`);
}

function isDerivedFromTemplate(): boolean {
  const originUrl = getRemoteUrl('origin');
  const upstreamUrl = getRemoteUrl('upstream');

  if (!upstreamUrl || !isTemplateRemote(upstreamUrl)) {
    return false;
  }

  // Working directly on the template repo should not be blocked.
  return !isTemplateRemote(originUrl);
}

function resolveUpstreamRef(): string | null {
  const candidates = ['upstream/master', 'upstream/main', 'upstream/HEAD'];
  const found = candidates.find((candidate) => tryGit(`rev-parse --verify ${candidate}`));
  if (found) {
    return found;
  }

  const symbolicRef = tryGit('symbolic-ref --quiet refs/remotes/upstream/HEAD');
  if (!symbolicRef) {
    return null;
  }

  const remoteRef = symbolicRef.replace('refs/remotes/', '');
  return tryGit(`rev-parse --verify ${remoteRef}`) ? remoteRef : null;
}

function fileExistsInUpstream(upstreamRef: string, filePath: string): boolean {
  return tryGit(`cat-file -e ${upstreamRef}:${filePath}`) !== null;
}

function parseStagedChange(
  parts: string[],
  index: number,
  status: string
): { change: StagedChange; nextIndex: number } {
  if (status === 'R' || status === 'C') {
    return {
      change: { status, paths: [parts[index], parts[index + 1]] },
      nextIndex: index + 2,
    };
  }

  return {
    change: { status, paths: [parts[index]] },
    nextIndex: index + 1,
  };
}

function getStagedFileChanges(): StagedChange[] {
  const output = tryGit('diff --cached --name-status -z --diff-filter=ACDMRT');
  if (!output) {
    return [];
  }

  const parts = output.split('\0').filter(Boolean);
  const changes: StagedChange[] = [];

  for (let index = 0; index < parts.length; ) {
    const status = parts[index][0];
    const parsed = parseStagedChange(parts, index + 1, status);
    changes.push(parsed.change);
    index = parsed.nextIndex;
  }

  return changes;
}

function collectUpstreamModifiedFiles(
  stagedChanges: StagedChange[],
  upstreamRef: string
): string[] {
  return [
    ...new Set(
      stagedChanges.flatMap(({ status, paths }) => {
        if (status === 'A') {
          return [];
        }

        return paths.filter((filePath) => fileExistsInUpstream(upstreamRef, filePath));
      })
    ),
  ];
}

function warnMissingUpstreamRef(): void {
  console.warn(
    '⚠️  Skipping upstream file check: could not resolve an upstream branch ref (try `git fetch upstream`).'
  );
}

function printBlockedMessage(upstreamRef: string, upstreamFiles: string[]): void {
  console.error('\n❌ Pre-commit blocked: staged changes modify files from the template upstream.');
  console.error(`   Template: ${TEMPLATE_OWNER_REPO}`);
  console.error(`   Upstream ref: ${upstreamRef}`);
  console.error('\n   Files:');
  for (const filePath of upstreamFiles) {
    console.error(`   - ${filePath}`);
  }

  console.error('\n   General fixes and improvements to these core files should be contributed');
  console.error('   upstream via a pull request to the template repository.');
  console.error('\n   If you still intend to modify them in this fork, re-run your commit with an');
  console.error('   explicit acknowledgement using one of:');
  console.error(`     ${ACK_ENV_VAR}=1 git commit ...`);
  console.error(`     git -c ${ACK_GIT_CONFIG}=true commit ...`);
  console.error(`     bun scripts/check-upstream-modifications.ts ${ACK_CLI_FLAG}`);
  console.error('\n   Passing this flag confirms you understand upstream is the right place for');
  console.error('   general template changes, and your local edits are fork-specific.\n');
}

function shouldSkipCheck(): boolean {
  return hasAcknowledgement() || !isDerivedFromTemplate();
}

function getBlockedUpstreamFiles(): { upstreamRef: string; upstreamFiles: string[] } | null {
  const upstreamRef = resolveUpstreamRef();
  if (!upstreamRef) {
    warnMissingUpstreamRef();
    return null;
  }

  const upstreamFiles = collectUpstreamModifiedFiles(getStagedFileChanges(), upstreamRef);
  if (upstreamFiles.length === 0) {
    return null;
  }

  return { upstreamRef, upstreamFiles };
}

function main(): void {
  if (shouldSkipCheck()) {
    return;
  }

  const blocked = getBlockedUpstreamFiles();
  if (!blocked) {
    return;
  }

  printBlockedMessage(blocked.upstreamRef, blocked.upstreamFiles);
  process.exit(1);
}

main();
