'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
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

  const serverConfig = useSessionQuery(api.web.enhancer.index.getConfig, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  const upsertMutation = useSessionMutation(api.web.enhancer.index.upsertConfig);
  const disableMutation = useSessionMutation(api.web.enhancer.index.disableConfig);

  useEffect(() => {
    if (serverConfig === undefined) return;
    if (serverConfig === null) {
      clearEnhancerConfig(chatroomId);
      setConfig(null);
      return;
    }
    const hydrated: EnhancerConfig = {
      enabled: serverConfig.enabled,
      targetId: serverConfig.targetId,
      agentHarness: serverConfig.agentHarness,
      model: serverConfig.model,
      machineId: serverConfig.machineId,
    };
    setEnhancerConfig(chatroomId, hydrated);
    setConfig(hydrated);
  }, [serverConfig, chatroomId]);

  const saveConfig = useCallback(
    async (cfg: EnhancerConfig) => {
      setEnhancerConfig(chatroomId, cfg);
      setConfig(cfg);
      await upsertMutation({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        enabled: cfg.enabled,
        targetId: cfg.targetId,
        agentHarness: cfg.agentHarness,
        model: cfg.model,
        machineId: cfg.machineId,
      });
    },
    [chatroomId, upsertMutation]
  );

  const disable = useCallback(async () => {
    clearEnhancerConfig(chatroomId);
    setConfig(null);
    await disableMutation({ chatroomId: chatroomId as Id<'chatroom_rooms'> });
  }, [chatroomId, disableMutation]);

  return {
    config,
    isActive: isEnhancerConfigActive(config),
    saveConfig,
    disable,
  };
}
