'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { isEnhancerConfigActive, type EnhancerConfig } from '../types/enhancer';

interface UseEnhancerConfigOptions {
  workspaceId?: string | null;
  workingDir?: string | null;
}

export function useEnhancerConfig(chatroomId: string, options: UseEnhancerConfigOptions = {}) {
  const request = useSessionQuery(api.agents.getLastSentLaunchRequest, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role: 'enhancer',
    ...(options.workspaceId
      ? { workspaceId: options.workspaceId as Id<'chatroom_workspaces'> }
      : {}),
  });
  const saveConfigMutation = useSessionMutation(api.agents.saveConfig);
  const [optimisticConfig, setOptimisticConfig] = useState<EnhancerConfig | null>(null);
  const previousConfigRef = useRef<EnhancerConfig | null>(null);

  const serverConfig = useMemo<EnhancerConfig | null | undefined>(
    () =>
      request === undefined
        ? undefined
        : request === null
          ? null
          : {
              enabled: true,
              targetId: 'handoff:planner-to-builder',
              agentHarness: request.agentHarness,
              model: request.model,
              machineId: request.machineId,
            },
    [request]
  );

  const config = optimisticConfig ?? serverConfig ?? null;

  useEffect(() => {
    if (request === undefined) return;
    setOptimisticConfig(null);
    previousConfigRef.current = serverConfig ?? null;
  }, [request, serverConfig]);

  const serverIsActive: boolean | undefined =
    serverConfig === undefined ? undefined : isEnhancerConfigActive(serverConfig);

  const saveConfig = useCallback(
    async (cfg: EnhancerConfig) => {
      if (!options.workspaceId || !options.workingDir) {
        throw new Error('An active workspace is required to save enhancer configuration');
      }
      const priorConfig = config;
      previousConfigRef.current = priorConfig;
      setOptimisticConfig(cfg);
      try {
        await saveConfigMutation({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          workspaceId: options.workspaceId as Id<'chatroom_workspaces'>,
          role: 'enhancer',
          machineId: cfg.machineId,
          agentHarness: cfg.agentHarness,
          model: cfg.model,
          workingDir: options.workingDir,
        });
      } catch (error) {
        setOptimisticConfig(previousConfigRef.current);
        throw error;
      }
    },
    [chatroomId, config, options.workingDir, options.workspaceId, saveConfigMutation]
  );

  const disable = useCallback(async () => {
    // The conversation mode is the per-message enablement switch. Keep the
    // reusable enhancer agent configuration so the next enable is immediate.
  }, []);

  return {
    config,
    isActive: isEnhancerConfigActive(config),
    serverIsActive,
    saveConfig,
    disable,
  };
}
