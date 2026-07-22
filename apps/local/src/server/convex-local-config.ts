import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type LocalConvexConfig = {
  deploymentName?: string;
  ports?: { cloud?: number; site?: number };
};

const ACTIVE_CONFIG_PATH = 'services/backend/.convex/local/default/config.json';
const CONVEX_DIR = 'services/backend/.convex';

function readConfigFile(path: string): LocalConvexConfig | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LocalConvexConfig;
  } catch {
    return null;
  }
}

function readNewestBackupConfig(repoRoot: string): LocalConvexConfig | null {
  try {
    const convexDir = join(repoRoot, CONVEX_DIR);
    const backups = readdirSync(convexDir)
      .filter((entry) => entry.startsWith('local-backup-'))
      .sort()
      .reverse();

    for (const backup of backups) {
      const config = readConfigFile(join(convexDir, backup, 'default/config.json'));
      if (config) return config;
    }
  } catch {
    return null;
  }

  return null;
}

/** Active local config, falling back to the newest on-disk backup. */
function readLocalConvexConfig(repoRoot: string): LocalConvexConfig | null {
  const active = readConfigFile(join(repoRoot, ACTIVE_CONFIG_PATH));
  if (active) return active;
  return readNewestBackupConfig(repoRoot);
}

export function localConvexDeployment(repoRoot: string): string | undefined {
  const name = readLocalConvexConfig(repoRoot)?.deploymentName;
  return name ? `local:${name}` : undefined;
}

export function localConvexCloudPort(repoRoot: string, fallback: number): number {
  return readLocalConvexConfig(repoRoot)?.ports?.cloud ?? fallback;
}

export function localConvexCloudUrl(repoRoot: string, fallbackPort: number): string {
  return `http://127.0.0.1:${localConvexCloudPort(repoRoot, fallbackPort)}`;
}

export function localConvexSitePort(repoRoot: string, fallback: number): number {
  const cloudPort = localConvexCloudPort(repoRoot, fallback);
  return readLocalConvexConfig(repoRoot)?.ports?.site ?? cloudPort + 1;
}
