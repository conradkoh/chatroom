import type { LocalConfigSnapshot } from '../shared/protocol.js';

export type LocalConfig = {
  repoRoot: string;
  managerPort: number;
  convexPort: number;
  webappPort: number;
  convexUrl: string;
  webappUrl: string;
};

function parsePort(value: string | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fallback;
  return n;
}

function readFlag(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

export function parseLocalConfig(repoRoot: string, argv: string[] = process.argv): LocalConfig {
  const managerPort = parsePort(
    readFlag(argv, 'manager-port') ?? process.env.LOCAL_MANAGER_PORT,
    3847
  );
  const webappPort = parsePort(
    readFlag(argv, 'webapp-port') ?? process.env.LOCAL_WEBAPP_PORT,
    3000
  );
  const convexPort = parsePort(
    readFlag(argv, 'convex-port') ?? process.env.LOCAL_CONVEX_PORT,
    3210
  );

  const convexUrl = `http://127.0.0.1:${convexPort}`;
  const webappUrl = `http://localhost:${webappPort}`;

  return { repoRoot, managerPort, convexPort, webappPort, convexUrl, webappUrl };
}

export function toConfigSnapshot(config: LocalConfig): LocalConfigSnapshot {
  const { managerPort, convexPort, webappPort, convexUrl, webappUrl } = config;
  return { managerPort, convexPort, webappPort, convexUrl, webappUrl };
}
