import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export type VercelProjectConfig = {
  projectId: string;
  orgId: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    const candidate = nonEmptyString(value);
    if (candidate) return candidate;
  }
  return null;
}

function parseVercelProject(value: unknown): VercelProjectConfig | null {
  const project = asRecord(value) ?? {};

  const projectId = firstNonEmptyString([project.projectId, project.id]);
  const orgId = nonEmptyString(project.orgId);
  if (!projectId || !orgId) return null;

  return { projectId, orgId };
}

function findRepoProject(value: unknown, projectDirectory: string): unknown {
  const repo = asRecord(value);
  if (!repo || !Array.isArray(repo.projects)) return null;

  return repo.projects.find((project) => asRecord(project)?.directory === projectDirectory);
}

function parseConvexUrlOutput(output: string): string | null {
  try {
    const value: unknown = JSON.parse(output.trim());
    if (typeof value !== 'string') return null;

    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

type ConvexQueryResult = { status: number | null; stdout: string | null };

function runProductionConvexUrlQuery(backendDirectory: string): ConvexQueryResult {
  return spawnSync(
    'pnpm',
    ['exec', 'convex', 'run', '--prod', '--inline-query', 'return process.env.CONVEX_CLOUD_URL'],
    {
      cwd: backendDirectory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
}

export function getProductionConvexUrl(
  backendDirectory: string,
  runQuery: (directory: string) => ConvexQueryResult = runProductionConvexUrlQuery
): string | null {
  const result = runQuery(backendDirectory);

  if (result.status !== 0 || !result.stdout) return null;
  return parseConvexUrlOutput(result.stdout);
}

export function readVercelProjectConfig(
  projectPath: string,
  projectDirectory?: string
): VercelProjectConfig | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(projectPath, 'utf8'));
    const directProject = parseVercelProject(parsed);
    if (directProject) return directProject;

    return projectDirectory ? parseVercelProject(findRepoProject(parsed, projectDirectory)) : null;
  } catch {
    return null;
  }
}

export function formatDeploymentEnv(convexUrl: string, vercelProject: VercelProjectConfig): string {
  return [
    `NEXT_PUBLIC_CONVEX_URL=${convexUrl}`,
    `VERCEL_PROJECT_ID=${vercelProject.projectId}`,
    `VERCEL_TEAM_ID=${vercelProject.orgId}`,
  ].join('\n');
}
