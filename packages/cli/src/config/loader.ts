import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

import { DEFAULT_CONFIG, DEFAULT_CONFIG_JSONC } from './defaults';
import type { ChatroomConfig, TeamDefinition } from './schema';
import { getConfigErrors } from './schema';

const CONFIG_DIR = '.chatroom';
const CONFIG_FILENAME = 'chatroom.jsonc';

/**
 * Get the global config path in user's home directory
 */
export function getGlobalConfigPath(): string {
  return join(homedir(), CONFIG_DIR, CONFIG_FILENAME);
}

/**
 * Get the global config directory in user's home directory
 */
export function getGlobalConfigDir(): string {
  return join(homedir(), CONFIG_DIR);
}

/**
 * Get the full path to the config file in a directory
 */
function getConfigPath(dir: string): string {
  return join(dir, CONFIG_DIR, CONFIG_FILENAME);
}

/**
 * Strip comments from JSONC content
 * Handles strings correctly to avoid removing // inside URLs
 */
function stripJsoncComments(content: string): string {
  let result = '';
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < content.length) {
    const char = content[i];
    const next = content[i + 1];

    if (escape) {
      result += char;
      escape = false;
      i++;
      continue;
    }

    if (char === '\\') {
      result += char;
      escape = true;
      i++;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      i++;
      continue;
    }

    if (inString) {
      result += char;
      i++;
      continue;
    }

    // Single-line comment
    if (char === '/' && next === '/') {
      // Skip to end of line
      while (i < content.length && content[i] !== '\n') {
        i++;
      }
      continue;
    }

    // Multi-line comment
    if (char === '/' && next === '*') {
      i += 2; // Skip /*
      while (i < content.length - 1 && !(content[i] === '*' && content[i + 1] === '/')) {
        i++;
      }
      i += 2; // Skip */
      continue;
    }

    result += char;
    i++;
  }

  return result;
}

/**
 * Find the config file by walking up the directory tree to home directory
 * Then falls back to the global config in ~/.chatroom/chatroom.jsonc
 */
export function findConfigPath(startDir: string = process.cwd()): string | null {
  const homeDir = homedir();
  let currentDir = startDir;

  // Walk up from startDir to home directory
  while (true) {
    const configPath = getConfigPath(currentDir);
    if (existsSync(configPath)) {
      return configPath;
    }

    // Stop when we've checked the home directory
    if (currentDir === homeDir) {
      break;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root without hitting home
      break;
    }
    currentDir = parentDir;
  }

  // Finally check global config path
  const globalPath = getGlobalConfigPath();
  if (existsSync(globalPath)) {
    return globalPath;
  }

  return null;
}

/**
 * Create a global config file with default configuration
 */
export function createGlobalConfig(): string {
  const globalDir = getGlobalConfigDir();

  // Create .chatroom directory if it doesn't exist
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }

  const configPath = getGlobalConfigPath();
  writeFileSync(configPath, DEFAULT_CONFIG_JSONC, 'utf-8');

  return configPath;
}

/**
 * Load and parse the configuration file
 * Returns null if file doesn't exist, throws on parse/validation errors
 */
export function loadConfigFromPath(configPath: string): ChatroomConfig {
  const content = readFileSync(configPath, 'utf-8');

  // Strip comments and parse JSON
  const jsonContent = stripJsoncComments(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (error) {
    const err = error as Error;
    throw new Error(`Failed to parse ${configPath}: ${err.message}`);
  }

  // Validate the configuration
  const errors = getConfigErrors(parsed);
  if (errors.length > 0) {
    throw new Error(`Invalid configuration in ${configPath}:\n  - ${errors.join('\n  - ')}`);
  }

  return parsed as ChatroomConfig;
}

/**
 * Load configuration from the nearest .chatroom/chatroom.jsonc or return defaults
 */
export function loadConfig(startDir: string = process.cwd()): {
  config: ChatroomConfig;
  configPath: string | null;
} {
  const configPath = findConfigPath(startDir);

  if (!configPath) {
    return { config: DEFAULT_CONFIG, configPath: null };
  }

  const config = loadConfigFromPath(configPath);
  return { config, configPath };
}

/**
 * Get a specific team from the configuration
 */
export function getTeam(config: ChatroomConfig, teamId: string): TeamDefinition | null {
  return config.teams[teamId] ?? null;
}

/**
 * Get the default team from the configuration
 */
export function getDefaultTeam(config: ChatroomConfig): TeamDefinition {
  const team = config.teams[config.defaultTeam];
  if (!team) {
    throw new Error(`Default team '${config.defaultTeam}' not found in configuration`);
  }
  return team;
}

/**
 * List all available team IDs
 */
export function getTeamIds(config: ChatroomConfig): string[] {
  return Object.keys(config.teams);
}

/**
 * Load a prompt override file from a path (relative to config file or absolute)
 * Returns null if the file doesn't exist
 */
export function loadPromptOverride(promptPath: string, configPath: string | null): string | null {
  // Resolve the path relative to the config file directory (or cwd)
  const baseDir = configPath ? dirname(configPath) : process.cwd();
  const resolvedPath = resolve(baseDir, promptPath);

  if (!existsSync(resolvedPath)) {
    return null;
  }

  return readFileSync(resolvedPath, 'utf-8');
}

/**
 * Check if system reminders are enabled in the configuration
 */
export function areSystemRemindersEnabled(config: ChatroomConfig): boolean {
  return config.prompts?.systemReminders?.enabled !== false;
}
