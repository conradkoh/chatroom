#!/usr/bin/env bun

import { execSync } from 'node:child_process';

import { isTemplateRemote, TEMPLATE_OWNER_REPO } from './template-repo';
import { classifyUpstreamFile } from './upstream-guard-policy';

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

function isUpstreamTrackedFile(upstreamRef: string, filePath: string): boolean {
  return fileExistsInUpstream(upstreamRef, filePath);
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

  for (let index = 0; index < parts.length;) {
    const status = parts[index][0];
    const parsed = parseStagedChange(parts, index + 1, status);
    changes.push(parsed.change);
    index = parsed.nextIndex;
  }

  return changes;
}

type UpstreamFileReport = {
  blocking: string[];
  warnings: string[];
};

function classifyStagedFile(
  filePath: string,
  report: { blocking: Set<string>; warnings: Set<string> }
): void {
  const tier = classifyUpstreamFile(filePath);
  if (tier === 'block') {
    report.blocking.add(filePath);
  } else if (tier === 'warn') {
    report.warnings.add(filePath);
  }
}

function collectStagedPaths(stagedChanges: StagedChange[]): string[] {
  return stagedChanges.filter(({ status }) => status !== 'A').flatMap(({ paths }) => paths);
}

function collectUpstreamModifiedFiles(
  stagedChanges: StagedChange[],
  upstreamRef: string
): UpstreamFileReport {
  const report = { blocking: new Set<string>(), warnings: new Set<string>() };
  const upstreamPaths = collectStagedPaths(stagedChanges).filter((filePath) =>
    isUpstreamTrackedFile(upstreamRef, filePath)
  );

  for (const filePath of upstreamPaths) {
    classifyStagedFile(filePath, report);
  }

  return { blocking: [...report.blocking], warnings: [...report.warnings] };
}

function printWarningMessage(filePaths: string[]): void {
  console.warn(
    '\nℹ️  Heads up: this commit changes files that also come from the template repository.'
  );
  console.warn('   Not blocked, but worth a look:');
  for (const filePath of filePaths) {
    console.warn(`   - ${filePath}`);
  }
  console.warn('   If this change is a general improvement, consider contributing it upstream.\n');
}

function warnMissingUpstreamRef(): void {
  console.warn(
    'ℹ️  Skipping template file check: no upstream branch found. Run `git fetch upstream` to enable it.'
  );
}

function printBlockedMessage(upstreamRef: string, upstreamFiles: string[]): void {
  console.error(
    '\n⚠️  This commit changes core files that also come from the template repository.'
  );
  console.error(`   Template: ${TEMPLATE_OWNER_REPO}`);
  console.error(`   Upstream ref: ${upstreamRef}`);
  console.error('\n   Files:');
  for (const filePath of upstreamFiles) {
    console.error(`   - ${filePath}`);
  }

  console.error(
    '\n   If this is a general fix, consider contributing it to the template via a pull request.'
  );
  console.error(
    '   If the change is specific to this fork, acknowledge it and commit again with one of:'
  );
  console.error(`     ${ACK_ENV_VAR}=1 git commit ...`);
  console.error(`     git -c ${ACK_GIT_CONFIG}=true commit ...`);
  console.error(`     bun scripts/check-upstream-modifications.ts ${ACK_CLI_FLAG}`);
  console.error('\n   Acknowledging means these edits are intentionally fork-specific.\n');
}

function shouldSkipCheck(): boolean {
  return hasAcknowledgement() || !isDerivedFromTemplate();
}

function reportUpstreamChanges(upstreamRef: string, report: UpstreamFileReport): void {
  if (report.blocking.length > 0) {
    printBlockedMessage(upstreamRef, report.blocking);
    process.exit(1);
  }
  if (report.warnings.length > 0) {
    printWarningMessage(report.warnings);
  }
}

function main(): void {
  if (shouldSkipCheck()) {
    return;
  }

  const upstreamRef = resolveUpstreamRef();
  if (!upstreamRef) {
    warnMissingUpstreamRef();
    return;
  }

  reportUpstreamChanges(
    upstreamRef,
    collectUpstreamModifiedFiles(getStagedFileChanges(), upstreamRef)
  );
}

main();
