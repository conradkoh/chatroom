/**
 * Machine Config Storage
 *
 * Manages machine configuration in ~/.chatroom/machine.json
 *
 * Config format is versioned and indexed by Convex URL:
 * {
 *   "version": "1",
 *   "machines": {
 *     "https://wonderful-raven-192.convex.cloud": { machineId, hostname, ... },
 *     "https://chatroom-cloud.duskfare.com": { machineId, hostname, ... }
 *   }
 * }
 */

import { randomBytes, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

import { detectAvailableHarnesses, detectHarnessVersions } from './detection.js';
import type {
  MachineConfig,
  MachineConfigFile,
  MachineEndpointConfig,
  MachineRegistrationInfo,
} from './types.js';
import { MACHINE_CONFIG_VERSION } from './types.js';
import { getConvexUrl } from '../convex/client.js';

const MACHINE_FILE = 'machine.json';

/** Serializes machine.json writes — concurrent saveMachineConfig calls must not share one .tmp path. */
let saveChain: Promise<void> = Promise.resolve();

function enqueueMachineConfigSave(task: () => Promise<void>): Promise<void> {
  const run = saveChain.then(task, task);
  saveChain = run.catch(() => undefined);
  return run;
}

/** Resolves on each call so tests (and rare HOME changes) see the current directory. */
function chatroomConfigDir(): string {
  return join(homedir(), '.chatroom');
}

/**
 * Ensure the chatroom config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  const dir = chatroomConfigDir();
  // SECURITY: 0o700 restricts directory access to owner only.
  // Machine config contains identity credentials (machineId).
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
}

/**
 * Get the path to the machine config file
 */
export function getMachineConfigPath(): string {
  return join(chatroomConfigDir(), MACHINE_FILE);
}

/**
 * Load the raw config file from disk.
 */
async function loadConfigFile(): Promise<MachineConfigFile | null> {
  const configPath = getMachineConfigPath();

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as MachineConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    // Don't silently swallow errors — a corrupted config means the machine
    // will re-register with a new UUID, losing its identity and agent configs.
    console.warn(`⚠️  Failed to read machine config at ${configPath}: ${(error as Error).message}`);
    console.warn(`   The machine will re-register with a new identity on next startup.`);
    console.warn(`   If this is unexpected, check the file for corruption.`);
    return null;
  }
}

/**
 * Write config to disk using a unique temp file + atomic rename.
 *
 * Each write uses a distinct temp path so concurrent writers cannot clobber
 * each other's tmp before rename (paired with enqueueMachineConfigSave).
 */
async function writeConfigFileAtomically(configFile: MachineConfigFile): Promise<void> {
  await ensureConfigDir();
  const configPath = getMachineConfigPath();
  const tempPath = `${configPath}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  const content = JSON.stringify(configFile, null, 2);

  // SECURITY: 0o600 restricts file access to owner only.
  // Machine config contains identity credentials (machineId).
  await fs.writeFile(tempPath, content, { mode: 0o600 });

  try {
    // Atomic rename — if the process crashes before this line, the original
    // config file remains intact. rename is atomic on POSIX filesystems.
    await fs.rename(tempPath, configPath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Load the machine configuration for the current Convex URL endpoint.
 *
 * @returns Machine config for the active endpoint, or null if not registered
 */
export async function loadMachineConfig(): Promise<MachineConfig | null> {
  const configFile = await loadConfigFile();
  if (!configFile) return null;

  const convexUrl = getConvexUrl();
  return configFile.machines[convexUrl] ?? null;
}

/**
 * Save machine configuration for the current Convex URL endpoint.
 */
export async function saveMachineConfig(config: MachineConfig): Promise<void> {
  await enqueueMachineConfigSave(async () => {
    const configFile = (await loadConfigFile()) ?? {
      version: MACHINE_CONFIG_VERSION,
      machines: {},
    };

    const convexUrl = getConvexUrl();
    configFile.machines[convexUrl] = config;
    await writeConfigFileAtomically(configFile);
  });
}

/** @internal — test only */
export async function _resetMachineConfigSaveChainForTests(): Promise<void> {
  await saveChain.catch(() => undefined);
  saveChain = Promise.resolve();
}

/**
 * Create a new machine endpoint configuration with generated UUID
 */
async function createNewEndpointConfig(): Promise<MachineEndpointConfig> {
  const now = new Date().toISOString();
  const availableHarnesses = await detectAvailableHarnesses();

  return {
    machineId: randomUUID(),
    hostname: hostname(),
    os: process.platform,
    registeredAt: now,
    lastSyncedAt: now,
    availableHarnesses,
    harnessVersions: await detectHarnessVersions(availableHarnesses),
  };
}

export type EnsureMachineRegisteredOptions = {
  /**
   * When true, creates local machine identity if missing for this Convex URL.
   * Only `machine start` (daemon bootstrap) should pass this — other callers must
   * require an existing registration so we never silently mint a new UUID mid-session.
   */
  allowCreate?: boolean;
};

/**
 * Ensure machine is registered for the current Convex URL (idempotent).
 *
 * When no local config exists: throws unless `allowCreate: true` (explicit first-time
 * bootstrap via daemon startup).
 *
 * @returns Machine registration info for backend sync
 */
export async function ensureMachineRegistered(
  options: EnsureMachineRegisteredOptions = {}
): Promise<MachineRegistrationInfo> {
  const { allowCreate = false } = options;
  let config = await loadMachineConfig();

  if (!config) {
    if (!allowCreate) {
      const convexUrl = getConvexUrl();
      throw new Error(
        `Machine not registered for endpoint "${convexUrl}". Run "chatroom machine start" to create a new machine identity for this deployment.`
      );
    }
    config = await createNewEndpointConfig();
    await saveMachineConfig(config);
  } else {
    // Refresh harness detection, versions, and update lastSyncedAt
    const now = new Date().toISOString();
    config.availableHarnesses = await detectAvailableHarnesses();
    config.harnessVersions = await detectHarnessVersions(config.availableHarnesses);
    config.lastSyncedAt = now;
    await saveMachineConfig(config);
  }

  return {
    machineId: config.machineId,
    hostname: config.hostname,
    os: config.os,
    availableHarnesses: config.availableHarnesses,
    harnessVersions: config.harnessVersions,
  };
}

/**
 * Get the machine ID for the current endpoint (or null if not registered).
 * Does not read stale disk state into a new identity — never creates or mutates config;
 * callers that require a registration must use {@link ensureMachineRegistered} or handle `null`.
 */
export async function getMachineId(): Promise<string | null> {
  const config = await loadMachineConfig();
  return config?.machineId ?? null;
}
