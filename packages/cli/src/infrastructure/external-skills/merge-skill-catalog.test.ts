/**
 * mergeSkillCatalog / findExternalSkill — pure merge tests.
 */
import { describe, expect, test } from 'vitest';

import {
  findExternalSkill,
  mergeSkillCatalog,
  type BuiltinSkillSummary,
} from './merge-skill-catalog.js';
import type { ExternalSkill, ExternalSkillDiscovery } from './types.js';

function externalSkill(skillId: string, root = '/roots/a'): ExternalSkill {
  return {
    skillId,
    name: skillId,
    description: `${skillId} description`,
    skillDir: `/store/${skillId}`,
    sourcePath: `${root}/${skillId}`,
    body: `# ${skillId}\n`,
  };
}

function builtin(skillId: string): BuiltinSkillSummary {
  return { skillId, name: skillId, description: `${skillId} builtin`, type: 'builtin' };
}

describe('mergeSkillCatalog', () => {
  test('builtin collision removes the external and records builtin-collision with its sourcePath', () => {
    const colliding = externalSkill('agent-browser', '/roots/home');
    const discovery: ExternalSkillDiscovery = { skills: [colliding], issues: [] };

    const catalog = mergeSkillCatalog([builtin('agent-browser')], discovery);

    expect(catalog.external).toEqual([]);
    expect(catalog.issues).toEqual([
      {
        path: '/roots/home/agent-browser',
        reason: 'builtin-collision',
        detail: 'builtin "agent-browser" takes precedence',
      },
    ]);
  });

  test('non-colliding externals pass through unchanged, and discovery issues come first', () => {
    const kept = externalSkill('local-tool');
    const discoveryIssue = { path: '/roots/x', reason: 'unreadable' as const, detail: 'EACCES' };
    const discovery: ExternalSkillDiscovery = { skills: [kept], issues: [discoveryIssue] };
    const builtins = [builtin('core'), builtin('other')];

    const catalog = mergeSkillCatalog(builtins, discovery);

    expect(catalog.builtin).toBe(builtins);
    expect(catalog.external).toEqual([kept]);
    expect(catalog.external[0]).toBe(kept);
    expect(catalog.issues).toEqual([discoveryIssue]);
  });

  test('discovery issues precede builtin-collision issues', () => {
    const discoveryIssue = { path: '/roots/x', reason: 'too-large' as const, detail: '99999' };
    const discovery: ExternalSkillDiscovery = {
      skills: [externalSkill('core')],
      issues: [discoveryIssue],
    };

    const catalog = mergeSkillCatalog([builtin('core')], discovery);

    expect(catalog.issues.map((i) => i.reason)).toEqual(['too-large', 'builtin-collision']);
    expect(catalog.issues[0]).toBe(discoveryIssue);
  });
});

describe('findExternalSkill', () => {
  const catalog = mergeSkillCatalog([], {
    skills: [externalSkill('alpha'), externalSkill('beta')],
    issues: [],
  });

  test('returns the entry on hit', () => {
    expect(findExternalSkill(catalog, 'beta')?.skillId).toBe('beta');
  });

  test('returns undefined on miss', () => {
    expect(findExternalSkill(catalog, 'missing')).toBeUndefined();
  });
});
