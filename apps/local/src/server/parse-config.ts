export type LaunchConfig = {
  repoRoot: string;
  managerPort: number;
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

export function parseLocalConfig(repoRoot: string, argv: string[] = process.argv): LaunchConfig {
  const managerPort = parsePort(
    readFlag(argv, 'manager-port') ?? process.env.LOCAL_MANAGER_PORT,
    3847
  );
  return { repoRoot, managerPort };
}
