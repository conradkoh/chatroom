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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

import { detectAvailableTools, detectToolVersions } from './detection.js';
import type {
  AgentContext,
  AgentTool,
  LegacyMachineConfig,
  MachineConfig,
  MachineConfigFile,
  MachineEndpointConfig,
  MachineRegistrationInfo,
} from './types.js';
import { MACHINE_CONFIG_VERSION } from './types.js';
import { getConvexUrl } from '../convex/client.js';

const CHATROOM_DIR = join(homedir(), '.chatroom');
const MACHINE_FILE = 'machine.json';

/**
 * Ensure the chatroom config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CHATROOM_DIR)) {
    mkdirSync(CHATROOM_DIR, { recursive: true });
  }
}

/**
 * Get the path to the machine config file
 */
export function getMachineConfigPath(): string {
  return join(CHATROOM_DIR, MACHINE_FILE);
}

/**
 * Check if a raw config object is the legacy (pre-versioned) format.
 * Legacy configs have `machineId` at the top level and no `version` field.
 */
function isLegacyConfig(raw: Record<string, unknown>): boolean {
  return 'machineId' in raw && !('version' in raw);
}

/**
 * Migrate a legacy config to the versioned format.
 * The legacy config becomes the entry for the current Convex URL.
 */
function migrateLegacyConfig(legacy: LegacyMachineConfig): MachineConfigFile {
  const convexUrl = getConvexUrl();

  const endpointConfig: MachineEndpointConfig = {
    machineId: legacy.machineId,
    hostname: legacy.hostname,
    os: legacy.os,
    registeredAt: legacy.registeredAt,
    lastSyncedAt: legacy.lastSyncedAt,
    availableTools: legacy.availableTools,
    toolVersions: {},
    chatroomAgents: legacy.chatroomAgents || {},
  };

  return {
    version: MACHINE_CONFIG_VERSION,
    machines: {
      [convexUrl]: endpointConfig,
    },
  };
}

/**
 * Load the raw config file from disk, handling migration from legacy format.
 */
function loadConfigFile(): MachineConfigFile | null {
  const configPath = getMachineConfigPath();

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const raw = JSON.parse(content) as Record<string, unknown>;

    // Check for legacy format and migrate
    if (isLegacyConfig(raw)) {
      const migrated = migrateLegacyConfig(raw as unknown as LegacyMachineConfig);
      // Save the migrated config back to disk
      saveConfigFile(migrated);
      return migrated;
    }

    return raw as unknown as MachineConfigFile;
  } catch {
    return null;
  }
}

/**
 * Save the config file to disk
 */
function saveConfigFile(configFile: MachineConfigFile): void {
  ensureConfigDir();
  const configPath = getMachineConfigPath();
  const content = JSON.stringify(configFile, null, 2);
  writeFileSync(configPath, content, 'utf-8');
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
  const availableTools = detectAvailableTools();

  return {
    machineId: randomUUID(),
    hostname: hostname(),
    os: process.platform,
    registeredAt: now,
    lastSyncedAt: now,
    availableTools,
    toolVersions: detectToolVersions(availableTools),
    chatroomAgents: {},
  };
}

/**
 * Ensure machine is registered for the current Convex URL (idempotent)
 *
 * Creates a new endpoint entry if not exists, otherwise refreshes tool detection.
 *
 * @returns Machine registration info for backend sync
 */
export function ensureMachineRegistered(): MachineRegistrationInfo {
  let config = loadMachineConfig();

  if (!config) {
    // First time registration for this endpoint
    config = createNewEndpointConfig();
    saveMachineConfig(config);
  } else {
    // Refresh tool detection, versions, and update lastSyncedAt
    const now = new Date().toISOString();
    config.availableTools = detectAvailableTools();
    config.toolVersions = detectToolVersions(config.availableTools);
    config.lastSyncedAt = now;
    // Update hostname in case it changed
    config.hostname = hostname();
    saveMachineConfig(config);
  }

  return {
    machineId: config.machineId,
    hostname: config.hostname,
    os: config.os,
    availableTools: config.availableTools,
    toolVersions: config.toolVersions,
  };
}

/**
 * Get the machine ID for the current endpoint (or null if not registered)
 */
export function getMachineId(): string | null {
  const config = loadMachineConfig();
  return config?.machineId ?? null;
}

/**
 * Update agent context for a specific chatroom and role
 */
export function updateAgentContext(
  chatroomId: string,
  role: string,
  agentType: AgentTool,
  workingDir: string
): void {
  const config = loadMachineConfig();
  if (!config) {
    throw new Error('Machine not registered. Run ensureMachineRegistered() first.');
  }

  const now = new Date().toISOString();

  // Ensure chatroom entry exists
  if (!config.chatroomAgents[chatroomId]) {
    config.chatroomAgents[chatroomId] = {};
  }

  // Update agent context
  config.chatroomAgents[chatroomId][role] = {
    agentType,
    workingDir,
    lastStartedAt: now,
  };

  saveMachineConfig(config);
}

/**
 * Get agent context for a specific chatroom and role
 */
export function getAgentContext(chatroomId: string, role: string): AgentContext | null {
  const config = loadMachineConfig();
  if (!config) {
    return null;
  }

  return config.chatroomAgents[chatroomId]?.[role] ?? null;
}

/**
 * List all chatrooms with registered agent contexts
 */
export function listChatroomAgents(): Record<string, Record<string, AgentContext>> {
  const config = loadMachineConfig();
  return config?.chatroomAgents ?? {};
}
