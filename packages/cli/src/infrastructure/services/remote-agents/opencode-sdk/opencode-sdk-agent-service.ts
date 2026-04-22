/**
 * OpenCodeSdkAgentService — RemoteAgentService stub for the 'opencode-sdk' harness.
 *
 * This service exists solely for harness detection and registration in the
 * RemoteAgentService registry. Actual agent spawning is handled by
 * OpenCodeSdkDriver (AgentToolDriver), not by this service.
 *
 * The SDK harness depends on the same `opencode` binary (it launches an HTTP
 * server via `opencode serve`), so we reuse the same CLI detection logic.
 *
 * spawn() throws — this harness uses the driver-based spawn path.
 */

import { execSync } from 'node:child_process';

import { BaseCLIAgentService, type CLIAgentServiceDeps } from '../base-cli-agent-service.js';
import type { SpawnOptions, SpawnResult } from '../remote-agent-service.js';

const OPENCODE_COMMAND = 'opencode';

export class OpenCodeSdkAgentService extends BaseCLIAgentService {
  readonly id = 'opencode-sdk';
  readonly displayName = 'OpenCode (SDK)';
  readonly command = OPENCODE_COMMAND;

  constructor(deps?: Partial<CLIAgentServiceDeps>) {
    const { execSync: execSyncDep, ...rest } = {
      execSync,
      ...deps,
    };
    super({ execSync: execSyncDep, ...rest });
  }

  isInstalled(): boolean {
    // Available when the opencode binary is installed (SDK wraps the same binary)
    return this.checkInstalled(OPENCODE_COMMAND);
  }

  getVersion() {
    return this.checkVersion(OPENCODE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    // Model discovery is handled by OpenCodeSdkDriver.listModels() (dynamicModelDiscovery)
    return [];
  }

  async spawn(_options: SpawnOptions): Promise<SpawnResult> {
    throw new Error(
      'OpenCodeSdkAgentService.spawn() is not supported — use OpenCodeSdkDriver.start() instead'
    );
  }
}
