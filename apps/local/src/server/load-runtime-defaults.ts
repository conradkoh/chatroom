import { join } from 'node:path';

import { readEnvFile } from './read-env.js';
import { loadSavedRuntimeConfig } from './saved-runtime-config.js';
import type { RuntimeConfig, RuntimeConfigDefaults } from '../shared/protocol.js';
import {
  DEFAULT_RUNTIME_CONFIG,
  defaultConvexBackendMode,
  findHostedConvexUrl,
  findLocalConvexUrl,
} from '../shared/runtime-config.js';

function loadEnvBasedDefaults(repoRoot: string): {
  runtime: RuntimeConfig;
  hostedUrl: string | null;
  webappPortFromEnv: number | null;
} {
  const backendEnv = readEnvFile(join(repoRoot, 'services/backend/.env.local'));
  const webappEnv = readEnvFile(join(repoRoot, 'apps/webapp/.env.local'));

  const hostedUrl = findHostedConvexUrl(
    backendEnv.VITE_CONVEX_URL,
    webappEnv.NEXT_PUBLIC_CONVEX_URL
  );
  const localUrl = findLocalConvexUrl(backendEnv.VITE_CONVEX_URL, webappEnv.NEXT_PUBLIC_CONVEX_URL);

  const webappPortFromEnv = webappEnv.PORT ? Number(webappEnv.PORT) : null;
  const webappPort =
    webappPortFromEnv && Number.isInteger(webappPortFromEnv)
      ? webappPortFromEnv
      : DEFAULT_RUNTIME_CONFIG.webappPort;

  const convexBackendMode = defaultConvexBackendMode(hostedUrl);
  const convexUrl =
    convexBackendMode === 'hosted' && hostedUrl
      ? hostedUrl
      : (localUrl ?? DEFAULT_RUNTIME_CONFIG.convexUrl);

  return {
    runtime: {
      webappPort,
      convexBackendMode,
      convexPort: DEFAULT_RUNTIME_CONFIG.convexPort,
      convexUrl,
    },
    hostedUrl,
    webappPortFromEnv,
  };
}

export function loadRuntimeDefaults(repoRoot: string, managerPort: number): RuntimeConfigDefaults {
  const { runtime: envDefaults, hostedUrl, webappPortFromEnv } = loadEnvBasedDefaults(repoRoot);
  const runtime = loadSavedRuntimeConfig(repoRoot) ?? envDefaults;

  return {
    managerPort,
    ...runtime,
    hostedConvexUrlFromEnv: hostedUrl,
    webappPortFromEnv,
  };
}
