/**
 * Tests for the role-level handoff template listing (discovery command data).
 */

import { describe, expect, test } from 'vitest';

import { listHandoffTemplates, type RoleHandoffTemplateListing } from './index';
import { formatHandoffTemplateListing, listHandoffTemplatesCommand } from './list-templates';

function requireListing(query: {
  role: string;
  teamId?: string | undefined;
}): RoleHandoffTemplateListing {
  const listing = listHandoffTemplates({ role: query.role, teamId: query.teamId });
  if (!listing) throw new Error(`missing listing for ${query.teamId ?? 'duo'}/${query.role}`);
  return listing;
}

describe('listHandoffTemplates', () => {
  test('duo planner lists receives/returns and builder/enhancer/user templates', () => {
    const listing = requireListing({ teamId: 'duo', role: 'planner' });

    expect(listing.teamId).toBe('duo');
    expect(listing.role).toBe('planner');
    expect(listing.receivesFrom.map((r) => r.toLowerCase())).toEqual(
      expect.arrayContaining(['user', 'builder', 'enhancer'])
    );
    expect(listing.returnsTo.map((r) => r.toLowerCase())).toEqual(
      expect.arrayContaining(['builder', 'enhancer', 'user'])
    );

    const targets = listing.templates.map((t) => t.toRole.toLowerCase());
    expect(targets).toEqual(['builder', 'enhancer', 'user']);
    for (const toRole of ['builder', 'enhancer', 'user']) {
      expect(
        listing.templates.find((t) => t.toRole.toLowerCase() === toRole)?.template
      ).toBeTruthy();
    }
  });

  test('duo builder lists planner only', () => {
    const listing = requireListing({ teamId: 'duo', role: 'builder' });

    expect(listing.receivesFrom.map((r) => r.toLowerCase())).toEqual(['planner']);
    expect(listing.returnsTo.map((r) => r.toLowerCase())).toEqual(['planner']);
    expect(listing.templates.map((t) => t.toRole.toLowerCase())).toEqual(['planner']);
    expect(listing.templates[0]?.template).toContain('Handoff Template (Builder → Planner)');
  });

  test('solo lists solo → user/enhancer templates', () => {
    const listing = requireListing({ teamId: 'solo', role: 'solo' });

    expect(listing.teamId).toBe('solo');
    expect(listing.receivesFrom.map((r) => r.toLowerCase())).toEqual(
      expect.arrayContaining(['user', 'enhancer'])
    );
    expect(listing.templates.map((t) => t.toRole.toLowerCase())).toEqual(['enhancer', 'user']);
    expect(listing.templates.find((t) => t.toRole === 'user')?.template).toContain(
      'Report Template (Solo → User)'
    );
    expect(listing.templates.find((t) => t.toRole === 'enhancer')?.template).toContain(
      'Planning Request (Solo → Enhancer)'
    );
  });

  test('role matching is case-insensitive and defaults team to duo', () => {
    expect(listHandoffTemplates({ role: 'PLANNER' })?.role).toBe('planner');
    expect(listHandoffTemplates({ role: 'Planner' })?.teamId).toBe('duo');
  });

  test('unknown role and unknown team return null (never throw)', () => {
    expect(listHandoffTemplates({ role: 'architect', teamId: 'duo' })).toBeNull();
    expect(listHandoffTemplates({ role: 'planner', teamId: 'tri' })).toBeNull();
    expect(listHandoffTemplates({ role: '', teamId: 'duo' })).toBeNull();
  });

  test('output order is deterministic', () => {
    const a = requireListing({ teamId: 'duo', role: 'planner' });
    const b = requireListing({ teamId: 'duo', role: 'planner' });
    expect(a).toEqual(b);
    expect(a.templates.map((t) => t.toRole.toLowerCase()).join(',')).toBe(
      b.templates.map((t) => t.toRole.toLowerCase()).join(',')
    );
  });
});

describe('listHandoffTemplatesCommand / formatHandoffTemplateListing', () => {
  test('formatted planner output includes role, receives, returns, and outbound mappings', () => {
    const output = listHandoffTemplatesCommand({ role: 'planner', teamId: 'duo' });

    expect(output).toContain('Handoff contract for `planner` (team: `duo`)');
    expect(output).toContain('Receives from:');
    expect(output).toContain('Returns to:');
    expect(output).toContain('Renderable outbound templates:');
    expect(output).toContain('- `planner` → `builder`');
    expect(output).toContain('- `planner` → `enhancer`');
    expect(output).toContain('- `planner` → `user`');
  });

  test('solo listing omits duplicate planner mappings and stays concise', () => {
    const output = formatHandoffTemplateListing(requireListing({ teamId: 'solo', role: 'solo' }));
    const templates = output.match(/^- `\w+` → `\w+`$/gm) ?? [];
    expect(templates).toHaveLength(2);
  });

  test('unknown role/team throws a descriptive error', () => {
    expect(() => listHandoffTemplatesCommand({ role: 'architect', teamId: 'duo' })).toThrow(
      /No handoff contract for role "architect"/i
    );
    expect(() => listHandoffTemplatesCommand({ role: 'planner', teamId: 'tri' })).toThrow(
      /No handoff contract for role "planner"/i
    );
  });
});
