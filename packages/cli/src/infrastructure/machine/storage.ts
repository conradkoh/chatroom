/**
 * Machine Config Storage
 *
 * Manages machine configuration in ~/.chatroom/machine.json
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';

import { detectAvailableTools } from './detection.js';
import type { AgentContext, AgentTool, MachineConfig, MachineRegistrationInfo } from './types.js';

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
 * Load the machine configuration from disk
 *
 * @returns Machine config or null if not exists
 */
export function loadMachineConfig(): MachineConfig | null {
  const configPath = getMachineConfigPath();

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as MachineConfig;
  } catch {
    return null;
  }
}

/**
 * Save machine configuration to disk
 */
export function saveMachineConfig(config: MachineConfig): void {
  ensureConfigDir();

  const configPath = getMachineConfigPath();
  const content = JSON.stringify(config, null, 2);

  writeFileSync(configPath, content, 'utf-8');
}

/**
 * Create a new machine configuration with generated UUID
 */
function createNewMachineConfig(): MachineConfig {
  const now = new Date().toISOString();

  return {
    machineId: randomUUID(),
    hostname: hostname(),
    os: process.platform,
    registeredAt: now,
    lastSyncedAt: now,
    availableTools: detectAvailableTools(),
    chatroomAgents: {},
  };
}

/**
 * Ensure machine is registered (idempotent)
 *
 * Creates machine.json if not exists, otherwise refreshes tool detection.
 *
 * @returns Machine registration info for backend sync
 */
export function ensureMachineRegistered(): MachineRegistrationInfo {
  let config = loadMachineConfig();

  if (!config) {
    // First time registration - create new config
    config = createNewMachineConfig();
    saveMachineConfig(config);
  } else {
    // Refresh tool detection and update lastSyncedAt
    const now = new Date().toISOString();
    config.availableTools = detectAvailableTools();
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
  };
}

/**
 * Get the machine ID (or null if not registered)
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
