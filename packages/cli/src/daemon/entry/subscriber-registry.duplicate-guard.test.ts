/**
 * G4 duplicate-subscription guard — legacy command-loop must not WS-subscribe
 * queries already covered by v2 subscribers in subscriber-registry.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cliPackageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const V2_SUBSCRIBED_QUERIES = [
  'api.workspaces.getPendingRequestsForWorkspace',
  'api.workspaceFiles.getPendingFileTreeRequests',
  'api.workspaceFiles.getPendingFileContentRequests',
  'api.workspaceFiles.getPendingFileWriteRequests',
  'api.workspaces.listRecentlyObservedWorkspacesForMachine',
  'api.daemon.commands.listActionableCommandRuns',
  'api.daemon.machineCommandInbox.watchNext',
  'api.daemon.enhancer.index.pendingForMachine',
] as const;

const LEGACY_INIT_FILES_TO_GUARD = [
  'src/daemon/entry/files/file-tree-subscription.ts',
  'src/daemon/entry/files/file-content-subscription.ts',
  'src/daemon/entry/files/file-write-subscription.ts',
  'src/daemon/entry/workspace-git/workspace-list-subscription.ts',
  'src/daemon/entry/handlers/process/command-run-subscription.ts',
  'src/daemon/entry/agentic-query/start-subscriptions.ts',
  'src/daemon/entry/enhancer/job-subscriber.ts',
  'src/daemon/entry/daemon-runtime.ts',
] as const;

const ALLOWED_LEGACY_WS = [
  'src/daemon/entry/handlers/process/log-observer-subscription.ts',
] as const;

function readRepoFile(relPath: string): string {
  return readFileSync(join(cliPackageRoot, relPath), 'utf8');
}

describe('subscriber-registry duplicate guard (G4)', () => {
  it('v2 subscriber-registry wires all migrated inbound contexts', () => {
    const registrySource = readRepoFile('src/daemon/entry/subscriber-registry.ts');
    expect(registrySource).toContain('startMachineCommandInboxSubscriber');
    expect(registrySource).not.toContain('startCommandEventsSubscriber');
    expect(registrySource).not.toContain('getCommandEvents');
    expect(registrySource).toContain('startCommandRunSubscriber');
    expect(registrySource).toContain('startGitRequestSubscriber');
    expect(registrySource).toContain('startFileTreeRequestSubscriber');
    expect(registrySource).toContain('startFileContentRequestSubscriber');
    expect(registrySource).toContain('startFileWriteRequestSubscriber');
    expect(registrySource).toContain('startAgenticQuerySessionSubscriber');
    expect(registrySource).toContain('startAgenticQueryPromptSubscriber');
    expect(registrySource).toContain('startEnhancerJobSubscriber');
  });

  it('git-request v2 subscriber does not WS-subscribe the machine-wide query', () => {
    const source = readRepoFile('src/daemon/infrastructure/convex/subscribers/git-request.ts');
    expect(source).not.toMatch(/onUpdate\([\s\S]*api\.workspaces\.getPendingRequests[,)\]]/);
  });

  it('legacy daemon-start does not onUpdate migrated Convex queries', () => {
    for (const relPath of LEGACY_INIT_FILES_TO_GUARD) {
      const source = readRepoFile(relPath);
      for (const query of V2_SUBSCRIBED_QUERIES) {
        expect(
          source,
          `${relPath} must not WS-subscribe ${query} (v2 subscriber is sole listener)`
        ).not.toMatch(new RegExp(`\\.onUpdate\\([\\s\\S]*${query.replace(/\./g, '\\.')}`));
      }
    }
  });

  it('legacy worker init does not import WS subscriber starters', () => {
    const forbidden = [
      'startMessageSubscriber',
      'startSessionSubscriber',
      'startCommandSubscriber',
      'runDualChannelFeedLive',
      'runIncrementalSubscribeLive',
    ];
    for (const relPath of LEGACY_INIT_FILES_TO_GUARD) {
      const source = readRepoFile(relPath);
      for (const name of forbidden) {
        expect(source, `${relPath} should not call ${name}`).not.toContain(`${name}(`);
      }
    }
  });

  it('allows log observer WS (no v2 subscriber)', () => {
    const source = readRepoFile(ALLOWED_LEGACY_WS[0]);
    expect(source).toContain('onUpdate');
  });
});
