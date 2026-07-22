'use client';

import { useCallback, useEffect, useState } from 'react';

import type { EnhancerConfig } from '../types/enhancer';
import { isEnhancerConfigActive } from '../types/enhancer';
import {
  getEnhancerConfig,
  setEnhancerConfig,
  clearEnhancerConfig,
} from '../stores/enhancerConfigStore';

export function useEnhancerConfig(chatroomId: string) {
  const [config, setConfig] = useState<EnhancerConfig | null>(() => getEnhancerConfig(chatroomId));

  useEffect(() => {
    setConfig(getEnhancerConfig(chatroomId));
  }, [chatroomId]);

  const saveConfig = useCallback(
    (cfg: EnhancerConfig) => {
      setEnhancerConfig(chatroomId, cfg);
      setConfig(cfg);
    },
    [chatroomId]
  );

  const disable = useCallback(() => {
    clearEnhancerConfig(chatroomId);
    setConfig(null);
  }, [chatroomId]);

  return {
    config,
    isActive: isEnhancerConfigActive(config),
    saveConfig,
    disable,
  };
}
