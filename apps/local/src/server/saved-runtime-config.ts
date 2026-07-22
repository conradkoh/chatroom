import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConvexBackendMode, RuntimeConfig } from '../shared/protocol.js';

const LOCAL_DEV_CONFIG_DIR = '.local-dev';
const CONFIG_FILE = 'config.json';

function configPath(repoRoot: string): string {
  return join(repoRoot, LOCAL_DEV_CONFIG_DIR, CONFIG_FILE);
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

function isValidBackendMode(value: unknown): value is ConvexBackendMode {
  return value === 'local' || value === 'hosted';
}

// fallow-ignore-next-line complexity
function parseSavedConfig(raw: unknown): RuntimeConfig | null {
  if (!raw || typeof raw !== 'object') return null;

  const data = raw as Record<string, unknown>;
  if (!isValidBackendMode(data.convexBackendMode)) return null;
  if (!isValidPort(data.webappPort) || !isValidPort(data.convexPort)) return null;
  if (typeof data.convexUrl !== 'string' || data.convexUrl.trim() === '') return null;

  return {
    webappPort: data.webappPort,
    convexBackendMode: data.convexBackendMode,
    convexPort: data.convexPort,
    convexUrl: data.convexUrl.trim(),
  };
}

export function loadSavedRuntimeConfig(repoRoot: string): RuntimeConfig | null {
  try {
    const contents = readFileSync(configPath(repoRoot), 'utf8');
    return parseSavedConfig(JSON.parse(contents));
  } catch {
    return null;
  }
}

export function saveSavedRuntimeConfig(repoRoot: string, config: RuntimeConfig): void {
  const dir = join(repoRoot, LOCAL_DEV_CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(repoRoot), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
