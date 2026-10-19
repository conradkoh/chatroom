/**
 * Key-file invariant: every (pair, mode bucket) has a file named
 * `<from>-<to>-<bucket>.ts` in its team's handoff-templates directory.
 *
 * The pair list comes from the role-owned catalogs, so this test cannot drift
 * from the contracts. The team is the directory, so a pair name never carries
 * the team.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { listHandoffTemplatePairs } from './index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEAMS_DIR = join(__dirname, '..', '..', 'teams');
const BUCKETS = ['chat', 'code'] as const;

const TEAMS = ['duo', 'solo'] as const;

describe('handoff template key files', () => {
  for (const team of TEAMS) {
    for (const pair of listHandoffTemplatePairs(team)) {
      for (const bucket of BUCKETS) {
        const file = `${pair.fromRole}-${pair.toRole}-${bucket}.ts`;
        test(`${team}: ${file} exists`, () => {
          expect(existsSync(join(TEAMS_DIR, team, 'handoff-templates', file))).toBe(true);
        });
      }
    }
  }
});
