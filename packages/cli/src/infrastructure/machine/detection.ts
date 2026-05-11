/**
 * Agent Harness Detection
 *
 * Detects which AI agent harnesses are installed on the current machine,
 * including version detection for compatibility gating.
 *
 * All detection is delegated to the harness registry — each RemoteAgentService
 * knows its own command and how to check installation / version.
 */

import { Effect } from 'effect';

import type { AgentHarness, HarnessVersionInfo } from './types.js';
import {
  initHarnessRegistry,
  getAllHarnesses,
  getHarness,
} from '../services/remote-agents/index.js';
import { BaseCLIAgentService } from '../services/remote-agents/base-cli-agent-service.js';
import {
  DetectionResult,
  isInstalled,
  isDetectionError,
} from '../services/remote-agents/detection-result.js';

/**
 * Detect the version of a specific agent harness.
 * Returns null if version cannot be detected.
 */
export async function detectHarnessVersion(
  harness: AgentHarness
): Promise<HarnessVersionInfo | null> {
  initHarnessRegistry();
  const info = await getHarness(harness)?.getVersion();
  if (!info) return null;
  return { version: info.version, major: info.major };
}

/**
 * Detect versions for all provided harnesses.
 * Returns a partial record (only harnesses with detectable versions).
 */
export async function detectHarnessVersions(
  harnesses: AgentHarness[]
): Promise<Partial<Record<AgentHarness, HarnessVersionInfo>>> {
  initHarnessRegistry();
  const versions: Partial<Record<AgentHarness, HarnessVersionInfo>> = {};

  const effects = harnesses.map((harness) =>
    Effect.promise(async () => {
      const version = await detectHarnessVersion(harness);
      return { harness, version };
    })
  );

  const results = await Effect.runPromise(Effect.all(effects, { concurrency: 'unbounded' }));

  for (const { harness, version } of results) {
    if (version) {
      versions[harness] = version;
    }
  }

  return versions;
}

/**
 * Detect which agent harnesses are installed on this machine.
 *
 * Uses tri-state detection for BaseCLIAgentService instances:
 * - Installed → included in result
 * - NotInstalled → silently excluded
 * - DetectionError → structured console.warn, excluded
 *
 * Falls back to boolean isInstalled() for non-base services.
 *
 * Detection runs in parallel across all harnesses via Effect.forEach
 * with unbounded concurrency.
 *
 * @returns Array of available agent harnesses
 */
export async function detectAvailableHarnesses(): Promise<AgentHarness[]> {
  initHarnessRegistry();
  const services = getAllHarnesses();

  const detectOne = (
    service: ReturnType<typeof getAllHarnesses>[number]
  ): Effect.Effect<{ id: string; result: DetectionResult }, never> => {
    if (service instanceof BaseCLIAgentService) {
      return service
        .detectInstallationEffect()
        .pipe(Effect.map((result) => ({ id: service.id, result })));
    }
    // Defensive fallback for non-base services — coerce unknown failures to false
    return Effect.promise(() => service.isInstalled().catch(() => false)).pipe(
      Effect.map((installed) => ({
        id: service.id,
        result: installed ? DetectionResult.Installed() : DetectionResult.NotInstalled(),
      }))
    );
  };

  const program = Effect.forEach(services, detectOne, { concurrency: 'unbounded' });
  const results = await Effect.runPromise(program);

  const installed: AgentHarness[] = [];
  for (const { id, result } of results) {
    if (isInstalled(result)) {
      installed.push(id as AgentHarness);
    } else if (isDetectionError(result)) {
      console.warn(
        JSON.stringify({
          event: 'harness-detection-error',
          harness: id,
          reason: result.reason,
          attempts: result.attempts,
        })
      );
    }
    // NotInstalled → silent
  }

  return installed;
}
