import { describe, expect, test } from 'vitest';

import {
  parseSessionAugmentation,
  sessionAugmentationToWantResume,
} from './parse-session-augmentation';

const LEGACY_SECTION = `## Restart new context
Hard = Full reset | Compact = Compress context | None = continue with previous context`;

const SESSION_MANAGEMENT_SECTION = `## Session Management
Valid values: \`new_session\` | \`none\``;

const SESSION_AUGMENTATION_SECTION = `## Session Augmentation
Valid values: \`none\` | \`compact\` | \`new_session\``;

describe('parseSessionAugmentation', () => {
  test('extracts new_session from Session Augmentation section', () => {
    const content = `${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=new_session`;
    expect(parseSessionAugmentation(content)).toBe('new_session');
  });

  test('extracts compact from session_augmentation tag', () => {
    const content = `${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=compact`;
    expect(parseSessionAugmentation(content)).toBe('compact');
  });

  test('extracts compact from legacy compress_context tag', () => {
    const content = `${SESSION_MANAGEMENT_SECTION}
// data:agent.compress_context=compact`;
    expect(parseSessionAugmentation(content)).toBe('compact');
  });

  test('maps legacy reset to new_session', () => {
    const content = `${LEGACY_SECTION}
// data:agent.compress_context=reset`;
    expect(parseSessionAugmentation(content)).toBe('new_session');
  });

  test('extracts none from section', () => {
    const content = `${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=none`;
    expect(parseSessionAugmentation(content)).toBe('none');
  });

  test('defaults to new_session when section is missing', () => {
    expect(parseSessionAugmentation('## Goal\nDo the thing')).toBe('new_session');
  });

  test('defaults to new_session when tag is missing from section', () => {
    expect(parseSessionAugmentation(SESSION_AUGMENTATION_SECTION)).toBe('new_session');
  });

  test('defaults to new_session for invalid tag value', () => {
    const content = `${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=invalid`;
    expect(parseSessionAugmentation(content)).toBe('new_session');
  });

  test('uses first tag within section when multiple present', () => {
    const content = `${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=new_session
// data:agent.session_augmentation=none`;
    expect(parseSessionAugmentation(content)).toBe('new_session');
  });

  test('does not read tag outside Session Augmentation section', () => {
    const content = `// data:agent.session_augmentation=new_session
${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=none`;
    expect(parseSessionAugmentation(content)).toBe('none');
  });

  test('stops at next ## heading', () => {
    const content = `${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=new_session

## Goal
// data:agent.session_augmentation=none`;
    expect(parseSessionAugmentation(content)).toBe('new_session');
  });

  test('is case-insensitive on tag value', () => {
    const content = `${SESSION_AUGMENTATION_SECTION}
// data:agent.session_augmentation=NEW_SESSION`;
    expect(parseSessionAugmentation(content)).toBe('new_session');
  });

  test('accepts legacy Session Management heading', () => {
    const content = `${SESSION_MANAGEMENT_SECTION}
// data:agent.compress_context=none`;
    expect(parseSessionAugmentation(content)).toBe('none');
  });

  test('accepts legacy Restart new context heading', () => {
    const content = `${LEGACY_SECTION}
// data:agent.compress_context=none`;
    expect(parseSessionAugmentation(content)).toBe('none');
  });
});

describe('sessionAugmentationToWantResume', () => {
  test('none → resume prior session', () => {
    expect(sessionAugmentationToWantResume('none')).toBe(true);
  });

  test('compact → resume prior session (no cold restart)', () => {
    expect(sessionAugmentationToWantResume('compact')).toBe(true);
  });

  test('new_session → cold spawn', () => {
    expect(sessionAugmentationToWantResume('new_session')).toBe(false);
  });
});
