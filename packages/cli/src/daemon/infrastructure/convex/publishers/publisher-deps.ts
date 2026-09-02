import type { BackendOps } from '../../../../infrastructure/deps/index.js';

export type ConvexPublisherDeps = {
  backend: BackendOps;
  sessionId: string;
  machineId: string;
  logEvent?:( (event: Record<string, unknown>) => Promise<void>) | undefined;
};
