import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent.js';
import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';

import {
  createSpawnPrompt,
  type SpawnPrompt,
} from '../../infrastructure/services/remote-agents/spawn-prompt.js';

export interface NativeSpawnPolicy {
  deferInitialTurn: boolean;
  prompt: SpawnPrompt;
}

/** Native harnesses defer the first turn — session starts idle, tasks arrive via injection. */
function shouldDeferInitialTurn(harness: AgentHarness): boolean {
  return isNativeHarness(harness);
}

/** Single entry point: derive deferInitialTurn + bootstrap prompt for a harness spawn. */
export function resolveNativeSpawnPolicy(
  harness: AgentHarness,
  initMessage: string | undefined | null
): NativeSpawnPolicy {
  const deferInitialTurn = shouldDeferInitialTurn(harness);
  return {
    deferInitialTurn,
    prompt: createSpawnPrompt(initMessage, { nativeBootstrap: deferInitialTurn }),
  };
}
