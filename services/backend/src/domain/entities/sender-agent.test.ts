import { describe, expect, test } from 'vitest';

import { AGENT_HARNESSES } from './agent';
import { normalizeSenderAgent, SENDER_AGENT_MODEL_MAX_LENGTH } from './sender-agent';

describe('normalizeSenderAgent', () => {
  test.each(AGENT_HARNESSES.map((harness) => [harness]))(
    'keeps a known harness without a model: %s',
    (harness) => {
      expect(normalizeSenderAgent({ harness })).toStrictEqual({ harness });
    }
  );

  test('keeps a valid harness and model', () => {
    expect(
      normalizeSenderAgent({ harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' })
    ).toStrictEqual({ harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' });
  });

  test('trims surrounding whitespace from the model', () => {
    expect(
      normalizeSenderAgent({ harness: 'claude-sdk', model: '  anthropic/claude-sonnet-4  ' })
    ).toStrictEqual({ harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' });
  });

  test('drops a whitespace-only model', () => {
    expect(normalizeSenderAgent({ harness: 'claude-sdk', model: '   ' })).toStrictEqual({
      harness: 'claude-sdk',
    });
  });

  test('drops an empty model', () => {
    expect(normalizeSenderAgent({ harness: 'claude-sdk', model: '' })).toStrictEqual({
      harness: 'claude-sdk',
    });
  });

  test('keeps a model exactly at the length cap', () => {
    const model = 'a'.repeat(SENDER_AGENT_MODEL_MAX_LENGTH);
    expect(normalizeSenderAgent({ harness: 'claude-sdk', model })).toStrictEqual({
      harness: 'claude-sdk',
      model,
    });
  });

  test('drops a model over the length cap without truncating the harness', () => {
    expect(
      normalizeSenderAgent({
        harness: 'claude-sdk',
        model: 'a'.repeat(SENDER_AGENT_MODEL_MAX_LENGTH + 1),
      })
    ).toStrictEqual({ harness: 'claude-sdk' });
  });

  test.each(['gpt\nx', 'gpt\tx', 'gpt\u0007x', 'gpt\u007fx'])(
    'drops a model containing a control character: %j',
    (model) => {
      expect(normalizeSenderAgent({ harness: 'claude-sdk', model })).toStrictEqual({
        harness: 'claude-sdk',
      });
    }
  );

  test.each(['', '   ', '\t \n'])('drops an empty or whitespace-only harness: %j', (harness) => {
    expect(normalizeSenderAgent({ harness, model: 'anthropic/claude-sonnet-4' })).toBeUndefined();
  });

  test.each(['gpt|x', 'gpt | x', 'gpt|'])(
    'drops a model containing the linear header delimiter |: %j',
    (model) => {
      expect(normalizeSenderAgent({ harness: 'claude-sdk', model })).toStrictEqual({
        harness: 'claude-sdk',
      });
    }
  );

  test.each(['gpt\u0085x', 'gpt\u2028x', 'gpt\u2029x'])(
    'drops a model containing U+0085, U+2028, or U+2029: %j',
    (model) => {
      expect(normalizeSenderAgent({ harness: 'claude-sdk', model })).toStrictEqual({
        harness: 'claude-sdk',
      });
    }
  );

  test('collapses internal whitespace runs in a model to single spaces', () => {
    expect(
      normalizeSenderAgent({ harness: 'claude-sdk', model: ' anthropic/claude   sonnet 4 ' })
    ).toStrictEqual({ harness: 'claude-sdk', model: 'anthropic/claude sonnet 4' });
  });

  test('drops an unknown harness even with a valid model', () => {
    expect(normalizeSenderAgent({ harness: 'not-a-harness', model: 'x' })).toBeUndefined();
  });

  test('drops an empty harness', () => {
    expect(normalizeSenderAgent({ harness: '' })).toBeUndefined();
  });

  test('drops a case-mismatched harness', () => {
    expect(normalizeSenderAgent({ harness: 'CLAUDE-SDK', model: 'x' })).toBeUndefined();
  });

  test('returns undefined for undefined input', () => {
    expect(normalizeSenderAgent(undefined)).toBeUndefined();
  });
});
