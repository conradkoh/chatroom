import { join } from 'node:path';

import { readEnvFile } from './read-env.js';
import type { RuntimeConfig, RuntimeConfigDefaults } from '../shared/protocol.js';

export function loadRuntimeDefaults(repoRoot: string, managerPort: number): RuntimeConfigDefaults {
  const backendEnv = readEnvFile(join(repoRoot, 'services/backend/.env.local'));
  const webappEnv = readEnvFile(join(repoRoot, 'apps/webapp/.env.local'));

  const hostedUrl = backendEnv.VITE_CONVEX_URL ?? webappEnv.NEXT_PUBLIC_CONVEX_URL ?? null;

  const webappPortFromEnv = webappEnv.PORT ? Number(webappEnv.PORT) : null;
  const webappPort =
    webappPortFromEnv && Number.isInteger(webappPortFromEnv) ? webappPortFromEnv : 3000;

  const convexBackendMode = hostedUrl && hostedUrl.includes('.convex.cloud') ? 'hosted' : 'local';

  const runtime: RuntimeConfig = {
    webappPort,
    convexBackendMode,
    convexPort: 3210,
    convexUrl: hostedUrl ?? 'http://127.0.0.1:3210',
  };

  return {
    managerPort,
    ...runtime,
    hostedConvexUrlFromEnv: hostedUrl,
    webappPortFromEnv,
  };
}
