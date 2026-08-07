import type { BoundHarness } from '../../domain/entities/bound-harness.js';
import {
  startBoundHarness,
  type NativeDirectHarnessName,
} from '../../infrastructure/local/harness/bound-harness-registry.js';
import { makeHarnessKey } from '../../infrastructure/local/harness/harness-key.js';

export async function getOrCreateBoundHarness(params: {
  harnesses: Map<string, BoundHarness>;
  workspaceId: string;
  harnessName: string;
  workingDir: string;
  convexUrl: string;
  logPrefix: string;
}): Promise<BoundHarness> {
  const { harnesses, workspaceId, harnessName, workingDir, convexUrl, logPrefix } = params;
  const key = makeHarnessKey(workspaceId, harnessName);
  let harness = harnesses.get(key);
  if (harness && !harness.isAlive()) {
    console.warn(
      `${logPrefix} Harness ${harnessName} for workspace ${workspaceId} is no longer alive — restarting`
    );
    harness.close().catch(() => {});
    harnesses.delete(key);
    harness = undefined;
  }
  if (!harness) {
    harness = await startBoundHarness({
      harnessName: harnessName as NativeDirectHarnessName,
      workingDir,
      workspaceId,
      resolvedConvexUrl: convexUrl,
    });
    harnesses.set(key, harness);
  }
  return harness;
}
