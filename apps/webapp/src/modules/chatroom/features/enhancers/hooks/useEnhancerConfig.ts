'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getEnhancerConfig,
  setEnhancerConfig,
  clearEnhancerConfig,
} from '../stores/enhancerConfigStore';
import { isEnhancerConfigActive, type EnhancerConfig } from '../types/enhancer';

export function useEnhancerConfig(chatroomId: string) {
  const [config, setConfig] = useState<EnhancerConfig | null>(() => getEnhancerConfig(chatroomId));
  const autoDisableAttemptRef = useRef<number | null>(null);

  const serverIsActive: boolean | undefined = undefined;

  useEffect(() => {
    if (config && !isEnhancerConfigActive(config)) {
      if (autoDisableAttemptRef.current !== 1) {
        autoDisableAttemptRef.current = 1;
        const disabled = { ...config, enabled: false };
        setEnhancerConfig(chatroomId, disabled);
        setConfig(disabled);
      }
    }
  }, [config, chatroomId]);

  const saveConfig = useCallback(
    async (cfg: EnhancerConfig) => {
      // Capture prior state for rollback on rejection.
      const priorConfig = getEnhancerConfig(chatroomId);
      setEnhancerConfig(chatroomId, cfg);
      setConfig(cfg);
      void priorConfig;
    },
    [chatroomId]
  );

  const disable = useCallback(async () => {
    if (config) {
      await saveConfig({ ...config, enabled: false });
      return;
    }
    clearEnhancerConfig(chatroomId);
    setConfig(null);
  }, [chatroomId, config, saveConfig]);

  return {
    config,
    isActive: isEnhancerConfigActive(config),
    serverIsActive,
    saveConfig,
    disable,
  };
}
