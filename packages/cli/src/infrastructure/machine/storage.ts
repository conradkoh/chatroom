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

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
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

/** Resolves on each call so tests (and rare HOME changes) see the current directory. */
function chatroomConfigDir(): string {
  return join(homedir(), '.chatroom');
}

/**
 * Ensure the chatroom config directory exists
 */
function ensureConfigDir(): void {
  const dir = chatroomConfigDir();
  if (!existsSync(dir)) {
    // SECURITY: 0o700 restricts directory access to owner only.
    // Machine config contains identity credentials (machineId).
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
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
function loadConfigFile(): MachineConfigFile | null {
  const configPath = getMachineConfigPath();

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as MachineConfigFile;
  } catch (error) {
    // Don't silently swallow errors — a corrupted config means the machine
    // will re-register with a new UUID, losing its identity and agent configs.
    console.warn(`⚠️  Failed to read machine config at ${configPath}: ${(error as Error).message}`);
    console.warn(`   The machine will re-register with a new identity on next startup.`);
    console.warn(`   If this is unexpected, check the file for corruption.`);
    return null;
  }
}

/**
 * Save the config file to disk using atomic write.
 *
 * Writes to a temp file first, then renames (atomic on most filesystems).
 * This prevents corruption if the process crashes mid-write.
 */
function saveConfigFile(configFile: MachineConfigFile): void {
  ensureConfigDir();
  const configPath = getMachineConfigPath();
  const tempPath = `${configPath}.tmp`;
  const content = JSON.stringify(configFile, null, 2);

  // SECURITY: 0o600 restricts file access to owner only.
  // Machine config contains identity credentials (machineId).
  writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o600 });

  // Atomic rename — if the process crashes before this line, the original
  // config file remains intact. renameSync is atomic on POSIX filesystems.
  renameSync(tempPath, configPath);
}

/**
 * Load the machine configuration for the current Convex URL endpoint.
 *
 * @returns Machine config for the active endpoint, or null if not registered
 */
export function loadMachineConfig(): MachineConfig | null {
  const configFile = loadConfigFile();
  if (!configFile) return null;

  const convexUrl = getConvexUrl();
  return configFile.machines[convexUrl] ?? null;
}

/**
 * Save machine configuration for the current Convex URL endpoint.
 */
export function saveMachineConfig(config: MachineConfig): void {
  const configFile = loadConfigFile() ?? {
    version: MACHINE_CONFIG_VERSION,
    machines: {},
  };

  const convexUrl = getConvexUrl();
  configFile.machines[convexUrl] = config;
  saveConfigFile(configFile);
}

/**
 * Create a new machine endpoint configuration with generated UUID
 */
function createNewEndpointConfig(): MachineEndpointConfig {
  const now = new Date().toISOString();
  const availableHarnesses = detectAvailableHarnesses();

  return {
    machineId: randomUUID(),
    hostname: hostname(),
    os: process.platform,
    registeredAt: now,
    lastSyncedAt: now,
    availableHarnesses,
    harnessVersions: detectHarnessVersions(availableHarnesses),
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
export function ensureMachineRegistered(
  options: EnsureMachineRegisteredOptions = {}
): MachineRegistrationInfo {
  const { allowCreate = false } = options;
  let config = loadMachineConfig();

  if (!config) {
    if (!allowCreate) {
      const convexUrl = getConvexUrl();
      throw new Error(
        `Machine not registered for endpoint "${convexUrl}". Run "chatroom machine start" to create a new machine identity for this deployment.`
      );
    }
    config = createNewEndpointConfig();
    saveMachineConfig(config);
  } else {
    // Refresh harness detection, versions, and update lastSyncedAt
    const now = new Date().toISOString();
    config.availableHarnesses = detectAvailableHarnesses();
    config.harnessVersions = detectHarnessVersions(config.availableHarnesses);
    config.lastSyncedAt = now;
    saveMachineConfig(config);
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
export function getMachineId(): string | null {
  const config = loadMachineConfig();
  return config?.machineId ?? null;
}
