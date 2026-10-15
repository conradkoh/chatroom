import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'bun:test';

const WORKFLOWS_DIRECTORY_RELATIVE_PATH = '.github/workflows';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

type WorkflowRecord = { [key: string]: unknown };
type MissingNeeds = { job: string; missing: string[] };
type WorkflowNeedsError = MissingNeeds & { file: string };

function asRecord(value: unknown): WorkflowRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as WorkflowRecord)
    : null;
}

/** GitHub Actions accepts `needs` as a single job name or a list of job names. */
function normalizeNeeds(needs: unknown): string[] {
  if (typeof needs === 'string') {
    return [needs];
  }

  if (Array.isArray(needs)) {
    return needs.filter((entry): entry is string => typeof entry === 'string');
  }

  return [];
}

/**
 * Returns every `needs` reference that names a job the workflow does not define.
 *
 * GitHub validates the whole workflow file up front and rejects it outright when a
 * `needs` key points at a non-existent job, so this list must stay empty for the
 * workflow to run at all.
 */
function findMissingNeeds(workflow: unknown): MissingNeeds[] {
  const jobs = asRecord(asRecord(workflow)?.jobs);
  if (!jobs) {
    return [];
  }

  const jobNames = new Set(Object.keys(jobs));
  const errors: MissingNeeds[] = [];

  for (const [job, definition] of Object.entries(jobs)) {
    const missing = normalizeNeeds(asRecord(definition)?.needs).filter(
      (dependency) => !jobNames.has(dependency)
    );
    if (missing.length > 0) {
      errors.push({ job, missing });
    }
  }

  return errors;
}

/**
 * Parses every workflow YAML file under the repo's workflow directory and returns
 * each `needs` reference that cannot be resolved to a job in the same file.
 */
function findWorkflowNeedsErrors(root: string): WorkflowNeedsError[] {
  const directory = join(root, WORKFLOWS_DIRECTORY_RELATIVE_PATH);
  const errors: WorkflowNeedsError[] = [];

  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) {
      continue;
    }

    const workflow = Bun.YAML.parse(readFileSync(join(directory, file), 'utf8'));
    for (const { job, missing } of findMissingNeeds(workflow)) {
      errors.push({ file, job, missing });
    }
  }

  return errors;
}

describe('normalizeNeeds', () => {
  it('accepts both the string and list forms GitHub allows', () => {
    expect(normalizeNeeds('tests')).toEqual(['tests']);
    expect(normalizeNeeds(['tests', 'deploy_backend'])).toEqual(['tests', 'deploy_backend']);
  });

  it('ignores absent or non-string values', () => {
    expect(normalizeNeeds(undefined)).toEqual([]);
    expect(normalizeNeeds({ job: 'tests' })).toEqual([]);
    expect(normalizeNeeds(['tests', 7])).toEqual(['tests']);
  });
});

describe('findMissingNeeds', () => {
  it('reports a needs reference that points at a renamed job', () => {
    // The pre-fix deploy-prod.yml shape: `migrate` still needed the old `deploy` name.
    const workflow = {
      jobs: {
        tests: {},
        deploy_backend: { needs: 'tests' },
        migrate: { needs: 'deploy' },
      },
    };

    expect(findMissingNeeds(workflow)).toEqual([{ job: 'migrate', missing: ['deploy'] }]);
  });

  it('accepts string and list needs that resolve to defined jobs', () => {
    const workflow = {
      jobs: {
        tests: {},
        deploy_backend: { needs: ['tests'] },
        migrate: { needs: 'deploy_backend' },
      },
    };

    expect(findMissingNeeds(workflow)).toEqual([]);
  });

  it('returns nothing when a workflow has no jobs', () => {
    expect(findMissingNeeds({ on: 'push' })).toEqual([]);
  });
});

describe('findWorkflowNeedsErrors', () => {
  it('reads workflows from a repo root and flags unresolvable needs', () => {
    const root = mkdtempSync(join(tmpdir(), 'workflow-needs-'));
    try {
      const directory = join(root, WORKFLOWS_DIRECTORY_RELATIVE_PATH);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'broken.yml'), 'jobs:\n  migrate:\n    needs: deploy\n');

      expect(findWorkflowNeedsErrors(root)).toEqual([
        { file: 'broken.yml', job: 'migrate', missing: ['deploy'] },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('every needs reference in this repository resolves to a defined job', () => {
    expect(findWorkflowNeedsErrors(repoRoot)).toEqual([]);
  });
});
