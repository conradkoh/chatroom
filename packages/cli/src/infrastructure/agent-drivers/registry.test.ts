import { describe, expect, it } from 'vitest';

import { OpenCodeProcessDriver } from './opencode-process-driver.js';
import { AgentDriverRegistry, createDefaultDriverRegistry } from './registry.js';

describe('AgentDriverRegistry', () => {
  describe('get', () => {
    it('resolves opencode driver', () => {
      const registry = createDefaultDriverRegistry();
      const driver = registry.get('opencode');
      expect(driver).toBeInstanceOf(OpenCodeProcessDriver);
      expect(driver.harness).toBe('opencode');
    });

    it('throws when harness is not registered', () => {
      const registry = new AgentDriverRegistry([]);
      expect(() => registry.get('opencode')).toThrow('No driver registered for harness: opencode');
    });
  });

  describe('all', () => {
    it('returns all registered drivers', () => {
      const registry = createDefaultDriverRegistry();
      const drivers = registry.all();
      expect(drivers.length).toBeGreaterThanOrEqual(1);
      expect(drivers.map((d) => d.harness)).toContain('opencode');
    });

    it('returns empty array when no drivers registered', () => {
      const registry = new AgentDriverRegistry([]);
      expect(registry.all()).toEqual([]);
    });
  });

  describe('capabilities', () => {
    it('returns opencode capabilities with modelSelection=true', () => {
      const registry = createDefaultDriverRegistry();
      const caps = registry.capabilities('opencode');
      expect(caps.modelSelection).toBe(true);
      expect(caps.sessionPersistence).toBe(false);
    });

    it('throws when harness is not registered', () => {
      const registry = new AgentDriverRegistry([]);
      expect(() => registry.capabilities('opencode')).toThrow();
    });
  });

  describe('stable capabilities', () => {
    it('returns consistent capabilities on repeated calls', () => {
      const registry = createDefaultDriverRegistry();
      const caps1 = registry.capabilities('opencode');
      const caps2 = registry.capabilities('opencode');
      expect(caps1).toEqual(caps2);
    });

    it('all registered harnesses expose capabilities', () => {
      const registry = createDefaultDriverRegistry();
      const drivers = registry.all();
      expect(drivers.length).toBeGreaterThan(0);

      for (const driver of drivers) {
        const capabilities = registry.capabilities(driver.harness);

        // Verify the capabilities object has all required boolean fields
        expect(capabilities).toHaveProperty('sessionPersistence');
        expect(capabilities).toHaveProperty('abort');
        expect(capabilities).toHaveProperty('modelSelection');
        expect(capabilities).toHaveProperty('compaction');
        expect(capabilities).toHaveProperty('eventStreaming');
        expect(capabilities).toHaveProperty('messageInjection');
        expect(capabilities).toHaveProperty('dynamicModelDiscovery');

        // Verify all values are booleans
        expect(typeof capabilities.sessionPersistence).toBe('boolean');
        expect(typeof capabilities.abort).toBe('boolean');
        expect(typeof capabilities.modelSelection).toBe('boolean');
        expect(typeof capabilities.compaction).toBe('boolean');
        expect(typeof capabilities.eventStreaming).toBe('boolean');
        expect(typeof capabilities.messageInjection).toBe('boolean');
        expect(typeof capabilities.dynamicModelDiscovery).toBe('boolean');
      }
    });
  });
});
