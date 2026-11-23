import { describe, expect, it } from 'vitest';

import { getSenderAgentLabel, SENDER_AGENT_SEGMENT_MAX_LENGTH } from './senderAgentLabel';

describe('getSenderAgentLabel', () => {
  it('returns the harness and model for a handoff with a complete snapshot', () => {
    expect(getSenderAgentLabel('handoff', { harness: 'opencode', model: 'gpt-5.1-codex' })).toEqual(
      { harness: 'opencode', model: 'gpt-5.1-codex' }
    );
  });

  it('keeps the harness alone when the snapshot has no model', () => {
    expect(getSenderAgentLabel('handoff', { harness: 'opencode' })).toEqual({
      harness: 'opencode',
      model: undefined,
    });
  });

  it('drops a non-string model but keeps the harness', () => {
    expect(getSenderAgentLabel('handoff', { harness: 'opencode', model: 42 })).toEqual({
      harness: 'opencode',
      model: undefined,
    });
  });

  it.each(['notice', 'message', 'user', ''])('renders nothing for type %j', (type) => {
    expect(getSenderAgentLabel(type, { harness: 'opencode', model: 'm' })).toBeUndefined();
  });

  it.each([undefined, null, 'opencode', 7, true])(
    'renders nothing for the non-object snapshot %j',
    (senderAgent) => {
      expect(getSenderAgentLabel('handoff', senderAgent)).toBeUndefined();
    }
  );

  it.each([{ harness: '' }, { harness: '   ' }, { harness: 42 }, { model: 'gpt' }, {}])(
    'renders nothing when the harness is unusable: %j',
    (senderAgent) => {
      expect(getSenderAgentLabel('handoff', senderAgent)).toBeUndefined();
    }
  );

  it('collapses whitespace runs and trims both segments', () => {
    expect(
      getSenderAgentLabel('handoff', { harness: '  open    code ', model: ' gpt   5.1 ' })
    ).toEqual({ harness: 'open code', model: 'gpt 5.1' });
  });

  it('drops a whitespace-only model but keeps a usable harness', () => {
    expect(getSenderAgentLabel('handoff', { harness: 'opencode', model: '   ' })).toEqual({
      harness: 'opencode',
      model: undefined,
    });
  });

  it('keeps a segment of exactly the maximum length unchanged', () => {
    const exact = 'x'.repeat(SENDER_AGENT_SEGMENT_MAX_LENGTH);
    expect(getSenderAgentLabel('handoff', { harness: exact, model: exact })).toEqual({
      harness: exact,
      model: exact,
    });
  });

  it('clips harness and model to 64 characters plus an ellipsis', () => {
    const long = 'x'.repeat(70);
    const expected = `${'x'.repeat(64)}…`;

    expect(getSenderAgentLabel('handoff', { harness: long, model: long })).toEqual({
      harness: expected,
      model: expected,
    });
  });
});
