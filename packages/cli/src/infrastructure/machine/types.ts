/**
 * Machine Identity Types
 *
 * Type definitions for machine configuration and agent management.
 * AgentHarness and HarnessVersionInfo are canonical in the backend domain layer.
 */

import type { AgentHarness, HarnessVersionInfo } from '@workspace/backend/src/domain/entities/agent';

export type { AgentHarness, HarnessVersionInfo };

/**
 * Per-endpoint machine entry in the versioned config file.
 * Each Convex URL endpoint gets its own machine identity.
 */
export interface MachineEndpointConfig {
  /** UUID generated once per machine per endpoint */
  machineId: string;
  /** Machine hostname */
  hostname: string;
  /** Operating system (darwin, linux, win32) */
  os: string;
  /** When machine was first registered (ISO string) */
  registeredAt: string;
  /** Last time config was synced (ISO string) */
  lastSyncedAt: string;
  /** Agent harnesses detected as available */
  availableHarnesses: AgentHarness[];
  /** Detected harness versions (keyed by harness name) */
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
}

/**
 * Current config file version
 */
export const MACHINE_CONFIG_VERSION = '1';

/**
 * Versioned machine config file stored in ~/.chatroom/machine.json
 * Indexed by Convex URL so a single machine can work with multiple endpoints.
 */
export interface MachineConfigFile {
  /** Config format version for migration support */
  version: string;
  /** Per-endpoint machine configurations, keyed by Convex URL */
  machines: Record<string, MachineEndpointConfig>;
}

/**
 * MachineConfig is now an alias for MachineEndpointConfig (for the active endpoint).
 * Callers that used loadMachineConfig() continue to get a single endpoint config.
 */
export type MachineConfig = MachineEndpointConfig;

/**
 * Minimal machine info for registration
 */
export interface MachineRegistrationInfo {
  machineId: string;
  hostname: string;
  os: string;
  availableHarnesses: AgentHarness[];
  harnessVersions: Partial<Record<AgentHarness, HarnessVersionInfo>>;
}
