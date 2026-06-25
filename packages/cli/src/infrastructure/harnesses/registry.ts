import { execSync } from 'node:child_process';

import { startCursorSdkHarness, createCursorSdkChunkExtractor } from './cursor-sdk/index.js';
import { createOpencodeSdkChunkExtractor } from './opencode-sdk/event-extractor.js';
import { startOpencodeSdkHarness } from './opencode-sdk/opencode-harness.js';
import { startPiSdkHarness, createPiSdkChunkExtractor } from './pi-sdk/index.js';
import { createStandardSdkChunkExtractor } from './shared-chunk-extractor.js';
import type {
  BoundHarness,
  NativeDirectHarnessName,
  StartBoundHarnessConfig,
} from '../../domain/direct-harness/entities/bound-harness.js';
import type { DirectHarnessSessionEvent } from '../../domain/direct-harness/entities/direct-harness-session.js';
import type { ExtractedChunk } from '../../domain/direct-harness/usecases/open-session.js';

export type { NativeDirectHarnessName } from '../../domain/direct-harness/entities/bound-harness.js';

export const NATIVE_DIRECT_HARNESS_NAMES = [
  'opencode-sdk',
  'cursor-sdk',
  'pi-sdk',
] as const satisfies readonly NativeDirectHarnessName[];

export function isNativeDirectHarnessName(name: string): name is NativeDirectHarnessName {
  return (NATIVE_DIRECT_HARNESS_NAMES as readonly string[]).includes(name);
}

export type ChunkExtractor = (event: DirectHarnessSessionEvent) => ExtractedChunk | null;

export async function startBoundHarness(config: StartBoundHarnessConfig): Promise<BoundHarness> {
  switch (config.harnessName) {
    case 'opencode-sdk':
      return startOpencodeSdkHarness(config);
    case 'cursor-sdk':
      return startCursorSdkHarness(config);
    case 'pi-sdk':
      return startPiSdkHarness(config);
    default: {
      const _exhaustive: never = config.harnessName;
      throw new Error(`Unsupported direct harness: ${String(_exhaustive)}`);
    }
  }
}

export function createChunkExtractor(harnessName: string): ChunkExtractor {
  switch (harnessName) {
    case 'opencode-sdk':
      return createOpencodeSdkChunkExtractor();
    case 'cursor-sdk':
      return createCursorSdkChunkExtractor();
    case 'pi-sdk':
      return createPiSdkChunkExtractor();
    default:
      return createStandardSdkChunkExtractor();
  }
}

function opencodeOnPath(): boolean {
  try {
    execSync('opencode --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function isCursorSdkInstalled(): Promise<boolean> {
  if (!process.env.CURSOR_API_KEY?.trim()) return false;
  try {
    const { importBundledCursorSdk } =
      await import('../services/remote-agents/cursor-sdk/cursor-sdk-package.js');
    await importBundledCursorSdk();
    return true;
  } catch {
    return false;
  }
}

async function isPiSdkInstalled(): Promise<boolean> {
  try {
    const { importBundledPiSdk } =
      await import('../services/remote-agents/pi-sdk/pi-sdk-package.js');
    const { ModelRegistry, AuthStorage } = await importBundledPiSdk();
    const authStorage = AuthStorage.create();
    const modelRegistry = ModelRegistry.create(authStorage);
    return modelRegistry.getAvailable().length > 0;
  } catch {
    return false;
  }
}

/** Returns native direct harness names that are installed on this machine. */
export async function listInstalledNativeDirectHarnesses(): Promise<NativeDirectHarnessName[]> {
  const installed: NativeDirectHarnessName[] = [];
  if (opencodeOnPath()) installed.push('opencode-sdk');
  if (await isCursorSdkInstalled()) installed.push('cursor-sdk');
  if (await isPiSdkInstalled()) installed.push('pi-sdk');
  return installed;
}
