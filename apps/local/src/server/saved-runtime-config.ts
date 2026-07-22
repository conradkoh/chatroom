import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseRuntimeConfig } from '../shared/parse-runtime-config.js';
import type { RuntimeConfig } from '../shared/protocol.js';

const LOCAL_DEV_CONFIG_DIR = '.local-dev';
const CONFIG_FILE = 'config.json';

function configPath(repoRoot: string): string {
  return join(repoRoot, LOCAL_DEV_CONFIG_DIR, CONFIG_FILE);
}

export function loadSavedRuntimeConfig(repoRoot: string): RuntimeConfig | null {
  try {
    const contents = readFileSync(configPath(repoRoot), 'utf8');
    return parseRuntimeConfig(JSON.parse(contents));
  } catch {
    return null;
  }
}

export function saveSavedRuntimeConfig(repoRoot: string, config: RuntimeConfig): void {
  const dir = join(repoRoot, LOCAL_DEV_CONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(repoRoot), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
