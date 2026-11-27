/**
 * The carry-over preview for the Review stage.
 *
 * Pure derivation over the chatroom's launch configs and the target machine's harnesses. The UI
 * labels the result "Expected": the backend repeats this work transactionally, so the preview is
 * never authority.
 */

import { normalizeWorkingDir } from './switchWorkspaceCopy';

export interface CarryOverPreview {
  expected: string[];
  atRisk: { role: string; harness: string }[];
}

export interface PreviewConfig {
  role: string;
  machineId: string;
  workingDir: string;
  agentType: string;
}

/**
 * Configs whose machine and folder match `from` are the ones that would be carried over.
 * A role is at risk when the target's harnesses are loaded and do not include its harness.
 * `targetHarnesses` is null while capabilities load: every role then counts as expected.
 * Returns null when no config belongs to `from`.
 */
// fallow-ignore-next-line complexity
export function buildCarryOverPreview(
  configs: readonly PreviewConfig[],
  from: { machineId: string | null; workingDir: string },
  targetHarnesses: readonly string[] | null
): CarryOverPreview | null {
  const own = configs.filter(
    (c) =>
      c.machineId === from.machineId &&
      normalizeWorkingDir(c.workingDir) === normalizeWorkingDir(from.workingDir)
  );
  if (own.length === 0) return null;
  const expected: string[] = [];
  const atRisk: { role: string; harness: string }[] = [];
  for (const config of own) {
    if (targetHarnesses !== null && !targetHarnesses.includes(config.agentType)) {
      atRisk.push({ role: config.role, harness: config.agentType });
    } else {
      expected.push(config.role);
    }
  }
  return { expected, atRisk };
}
