import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEnhancerConfig, setEnhancerConfig, clearEnhancerConfig } from './enhancerConfigStore';
import type { EnhancerConfig } from '../types/enhancer';

const CHATROOM_ID = 'room-1';

function makeConfig(overrides?: Partial<EnhancerConfig>): EnhancerConfig {
  return {
    enabled: true,
    targetId: 'handoff:planner-to-builder',
    agentHarness: 'opencode',
    model: 'anthropic/claude-opus-4',
    machineId: 'machine-1',
    ...overrides,
  };
}

describe('enhancerConfigStore', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when no config stored', () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    expect(getEnhancerConfig(CHATROOM_ID)).toBeNull();
  });

  it('returns parsed config when valid', () => {
    const config = makeConfig();
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(config));
    expect(getEnhancerConfig(CHATROOM_ID)).toEqual(config);
  });

  it('returns null for invalid JSON', () => {
    vi.mocked(localStorage.getItem).mockReturnValue('not-json');
    expect(getEnhancerConfig(CHATROOM_ID)).toBeNull();
  });

  it('returns null for malformed config', () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ enabled: true }));
    expect(getEnhancerConfig(CHATROOM_ID)).toBeNull();
  });

  it('stores config via setEnhancerConfig', () => {
    const config = makeConfig();
    setEnhancerConfig(CHATROOM_ID, config);
    expect(localStorage.setItem).toHaveBeenCalledWith(
      `chatroom:enhancer-config:${CHATROOM_ID}`,
      JSON.stringify(config)
    );
  });

  it('clears config via clearEnhancerConfig', () => {
    clearEnhancerConfig(CHATROOM_ID);
    expect(localStorage.removeItem).toHaveBeenCalledWith(`chatroom:enhancer-config:${CHATROOM_ID}`);
  });
});
