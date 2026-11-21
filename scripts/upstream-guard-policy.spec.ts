import { describe, expect, it } from 'bun:test';

import { classifyUpstreamFile, type UpstreamGuardTier } from './upstream-guard-policy';

const CASES: { tier: UpstreamGuardTier; filePaths: string[] }[] = [
  {
    tier: 'allow',
    filePaths: [
      'pnpm-lock.yaml',
      'services/backend/convex/_generated/api.d.ts',
      'package.json',
      'services/backend/package.json',
      'services/backend/convex/schema.ts',
      'apps/webapp/public/next.svg',
      'apps/webapp/public/appicon-192x192.png',
      'apps/webapp/src/app/favicon.ico',
      'services/backend/config/featureFlags.ts',
    ],
  },
  {
    tier: 'warn',
    filePaths: [
      'README.md',
      'AGENTS.md',
      'docs/developer/setup.md',
      '.github/workflows/ci.yml',
      '.husky/pre-commit',
      'eslint.config.mjs',
      'apps/webapp/next.config.ts',
      'turbo.json',
      '.prettierrc',
      'scripts/devPort.ts',
      'apps/webapp/tsconfig.json',
      '.fallow/baseline.json',
      '.fallow/dupes-baseline.json',
      'apps/webapp/src/app/globals.css',
      'apps/webapp/components.json',
      'services/backend/config/signupMethods.ts',
    ],
  },
  {
    tier: 'block',
    filePaths: [
      'apps/webapp/src/app/page.tsx',
      'services/backend/convex/sessions.ts',
      'packages/shared/src/index.ts',
    ],
  },
];

describe('classifyUpstreamFile', () => {
  for (const { tier, filePaths } of CASES) {
    for (const filePath of filePaths) {
      it(`classifies ${filePath} as ${tier}`, () => {
        expect(classifyUpstreamFile(filePath)).toBe(tier);
      });
    }
  }
});
