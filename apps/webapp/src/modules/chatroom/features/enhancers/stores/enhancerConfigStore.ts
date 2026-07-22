import type { EnhancerConfig } from '../types/enhancer';

const STORAGE_KEY_PREFIX = 'chatroom:enhancer-config:';

function storageKey(chatroomId: string): string {
  return `${STORAGE_KEY_PREFIX}${chatroomId}`;
}

export function getEnhancerConfig(chatroomId: string): EnhancerConfig | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(storageKey(chatroomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.enabled !== 'boolean' ||
      typeof parsed.targetId !== 'string' ||
      typeof parsed.agentHarness !== 'string' ||
      typeof parsed.model !== 'string'
    ) {
      return null;
    }
    return parsed as EnhancerConfig;
  } catch {
    return null;
  }
}

export function setEnhancerConfig(chatroomId: string, config: EnhancerConfig): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(storageKey(chatroomId), JSON.stringify(config));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function clearEnhancerConfig(chatroomId: string): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(storageKey(chatroomId));
  } catch {
    // silently fail
  }
}
