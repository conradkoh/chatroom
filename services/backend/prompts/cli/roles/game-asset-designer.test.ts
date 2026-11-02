import { describe, expect, it } from 'vitest';

import { getGameAssetDesignerGuidance } from './game-asset-designer';

/**
 * Seam: `getGameAssetDesignerGuidance`.
 *
 * The role prompt must point at the three domain skills and stay free of the
 * domain commands, flags, and checklists those skills own. It must also keep
 * the generalizable process, evidence labels, audio checklist, and handoff.
 */
function guidance(): string {
  return getGameAssetDesignerGuidance({ recipientRole: 'planner' });
}

const SKILLS = ['game-asset-3d-ai', 'game-asset-2d-ai', 'game-asset-3d-procedural'] as const;

describe('game asset designer guidance — skills', () => {
  it.each(SKILLS)('names %s with its activation command', (skillId) => {
    const text = guidance();

    expect(text).toContain(skillId);
    expect(text).toContain(
      `chatroom skill activate ${skillId} --chatroom-id=<chatroom-id> --role=game-asset-designer`
    );
  });

  it.each([
    'chatroom generate-3d',
    'chatroom generate-image',
    'chatroom slice-image',
    'chatroom remove-image-background',
    'gltf-transform inspect',
    '--dry-run',
    '--confirm-cost',
    'metal-whole-texture',
    'Sheet grid',
  ])('keeps the domain command %s out of the role prompt', (domainText) => {
    expect(guidance()).not.toContain(domainText);
  });

  it('keeps the domain-neutral procedure and the skill pointer for generation', () => {
    const text = guidance();

    expect(text).toContain('P1 Recover the brief.');
    expect(text).toContain('P4 IF existing assets and an asset-in-rig render are named');
    expect(text).toContain('P5 Generate: activate the matching skill');
    expect(text).toContain('P9 Record the model or generator and tool');
    expect(text).toContain('P10 Apply checklist, label evidence, fill proofs');
    expect(text).toContain('P11 Hand off to');
    expect(text).not.toContain('P6 ');
    expect(text).not.toContain('P7 ');
    expect(text).not.toContain('P8 ');
  });

  it('keeps the generalizable checklists, evidence labels, and handoff', () => {
    const text = guidance();

    expect(text).toContain('**All assets**');
    expect(text).toContain('**Audio**');
    expect(text).not.toContain('**3D models**');
    expect(text).not.toContain('**2D sprites and UI art**');
    expect(text).toContain('`measured`');
    expect(text).toContain('`inspected`');
    expect(text).toContain('`specified`');
    expect(text).toContain('`unverified`');
    expect(text).toContain('### Scope boundary');
    expect(text).toContain('### Handoff');
    expect(text).toContain('chatroom handoff');
  });

  it('keeps the master R10 split for material warnings', () => {
    const text = guidance();

    expect(text).toContain(
      "If the generator's whole-surface metal warning (named in the matching skill) remains after one regeneration, or any other material warning remains, report it under Open questions."
    );
    expect(text).not.toContain(
      'every material warning the generator reports that remains after one regeneration'
    );
  });

  it('keeps one short principle for perspective and for the lighting anchor', () => {
    const text = guidance();

    expect(text).toContain('**One camera perspective per set.**');
    expect(text).toContain('**One lighting and palette anchor per set.**');
    expect(text).toContain('follow the contract and record the deviation under assumptions');
  });
});
