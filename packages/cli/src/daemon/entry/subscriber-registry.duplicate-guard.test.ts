/**
 * G4 duplicate-subscription guard — legacy command-loop must not WS-subscribe
 * queries already covered by v2 subscribers in subscriber-registry.ts.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { USER_INTENT_SUBSCRIBERS } from '../infrastructure/inbound/convex/user-intent-subscribers.js';

const cliPackageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const V2_SUBSCRIBED_QUERIES = [
  'api.workspaces.getPendingRequests',
  'api.workspaceFiles.getPendingFileTreeRequests',
  'api.workspaceFiles.getPendingFileContentRequests',
  'api.workspaceFiles.getPendingFileWriteRequests',
  'api.workspaces.listRecentlyObservedWorkspacesForMachine',
  'api.daemon.commands.listActionableCommandRuns',
  'api.machines.getCommandEvents',
  'api.daemon.enhancer.index.pendingForMachine',
] as const;

const LEGACY_INIT_FILES_TO_GUARD = [
  'src/daemon/entry/files/file-tree-subscription.ts',
  'src/daemon/entry/files/file-content-subscription.ts',
  'src/daemon/entry/files/file-write-subscription.ts',
  'src/daemon/entry/workspace-git/workspace-list-subscription.ts',
  'src/daemon/entry/handlers/process/command-run-subscription.ts',
  'src/daemon/entry/direct-harness/start-subscriptions.ts',
  'src/daemon/entry/agentic-query/start-subscriptions.ts',
  'src/daemon/entry/enhancer/job-subscriber.ts',
  'src/daemon/entry/daemon-runtime.ts',
  'src/daemon/entry/task-monitor-runtime.ts',
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
    expect(registrySource).toContain('startAssignedTaskSignalsSubscriber');
    expect(registrySource).toContain('startAssignedTaskPresenceSubscriber');
    expect(registrySource).toContain('startDirectHarnessSessionSubscriber');
    expect(registrySource).toContain('startDirectHarnessPromptSubscriber');
    expect(registrySource).toContain('startDirectHarnessCommandSubscriber');
    expect(registrySource).toContain('startCommandEventsSubscriber');
    expect(registrySource).toContain('startCommandRunSubscriber');
    expect(registrySource).toContain('startWorkspaceListSubscriber');
    expect(registrySource).toContain('startGitRequestSubscriber');
    expect(registrySource).toContain('startFileTreeRequestSubscriber');
    expect(registrySource).toContain('startFileContentRequestSubscriber');
    expect(registrySource).toContain('startFileWriteRequestSubscriber');
    expect(registrySource).toContain('startAgenticQuerySessionSubscriber');
    expect(registrySource).toContain('startAgenticQueryPromptSubscriber');
    expect(registrySource).toContain('startEnhancerJobSubscriber');
  });

  it('P5 inbound registry registers only user-intent subscribers (no orchestration)', () => {
    const inboundSource = readRepoFile(
      'src/daemon/infrastructure/inbound/convex/subscriber-registry.ts'
    );
    for (const starter of [
      'startGitRequestSubscriber',
      'startFileTreeRequestSubscriber',
      'startFileContentRequestSubscriber',
      'startFileWriteRequestSubscriber',
      'startWorkspaceListSubscriber',
      'startCommandEventsSubscriber',
      'startCommandRunSubscriber',
      'startDirectHarnessSessionSubscriber',
      'startDirectHarnessPromptSubscriber',
      'startDirectHarnessCommandSubscriber',
      'startAgenticQuerySessionSubscriber',
      'startAgenticQueryPromptSubscriber',
    ]) {
      expect(inboundSource).toContain(starter);
    }
    expect(inboundSource).not.toContain('startAssignedTaskSignalsSubscriber');
    expect(inboundSource).not.toContain('startAssignedTaskPresenceSubscriber');
    expect(inboundSource).not.toContain('startEnhancerJobSubscriber');
  });

  it('P5 user-intent subscriber list matches the inbound registry count', () => {
    expect(USER_INTENT_SUBSCRIBERS).toHaveLength(13);
    expect(USER_INTENT_SUBSCRIBERS).toContain('daemon-orchestration-intents');
    expect(USER_INTENT_SUBSCRIBERS).not.toContain('assigned-task-signals');
    expect(USER_INTENT_SUBSCRIBERS).not.toContain('assigned-task-presence');
    expect(USER_INTENT_SUBSCRIBERS).not.toContain('enhancer-job');
  });

  it('P5 entry registry delegates to inbound registry behind the flag', () => {
    const registrySource = readRepoFile('src/daemon/entry/subscriber-registry.ts');
    expect(registrySource).toContain('isDaemonOrchestrationP5Enabled');
    expect(registrySource).toContain('startInboundSubscribers');
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
