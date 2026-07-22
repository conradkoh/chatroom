'use client';

import { Check } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { EnhancerConfig } from '../types/enhancer';
import { isEnhancerConfigActive } from '../types/enhancer';
import { ENHANCER_TARGETS } from '../constants/enhancerTargets';
import { EnhancerHarnessModelSelect } from './EnhancerHarnessModelSelect';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog';
import type { AgentHarness } from '../../../types/machine';

interface EnhancerConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatroomId: string;
  machineId: string | null | undefined;
  initialConfig: EnhancerConfig | null;
  onConfirm: (config: EnhancerConfig) => void;
  onDisable: () => void;
}

export function EnhancerConfigDialog({
  open,
  onOpenChange,
  machineId,
  initialConfig,
  onConfirm,
  onDisable,
}: EnhancerConfigDialogProps) {
  const [targetId, setTargetId] = useState<string>(
    initialConfig?.targetId ?? ENHANCER_TARGETS[0].id
  );
  const [agentHarness, setAgentHarness] = useState<AgentHarness | null>(
    initialConfig?.agentHarness ?? null
  );
  const [model, setModel] = useState<string>(initialConfig?.model ?? '');

  const canEnable = !!targetId && !!agentHarness && !!model;

  const handleConfirm = useCallback(() => {
    if (!canEnable) return;
    onConfirm({
      enabled: true,
      targetId: targetId as EnhancerConfig['targetId'],
      agentHarness,
      model,
    });
  }, [canEnable, targetId, agentHarness, model, onConfirm]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setTargetId(initialConfig?.targetId ?? ENHANCER_TARGETS[0].id);
        setAgentHarness(initialConfig?.agentHarness ?? null);
        setModel(initialConfig?.model ?? '');
      }
      onOpenChange(nextOpen);
    },
    [initialConfig, onOpenChange]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enhancer configuration</DialogTitle>
          <DialogDescription>
            Configure which handoff stage to enhance and which model to use.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div>
            <label className="block text-xs font-medium text-chatroom-text-secondary mb-2">
              Target
            </label>
            <div className="flex flex-col gap-1.5">
              {ENHANCER_TARGETS.map((target) => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => setTargetId(target.id)}
                  className={`flex items-start gap-2 px-2 py-2 border-2 text-left transition-colors ${
                    targetId === target.id
                      ? 'border-chatroom-accent bg-chatroom-accent/5'
                      : 'border-chatroom-border hover:border-chatroom-border-strong'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex-shrink-0 w-4 h-4 flex items-center justify-center border-2 ${
                      targetId === target.id
                        ? 'border-chatroom-accent bg-chatroom-accent text-chatroom-bg-primary'
                        : 'border-chatroom-border'
                    }`}
                  >
                    {targetId === target.id && <Check size={12} />}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm text-chatroom-text-primary">{target.label}</span>
                    <span className="text-xs text-chatroom-text-muted mt-0.5">
                      {target.description}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <EnhancerHarnessModelSelect
            machineId={machineId}
            agentHarness={agentHarness}
            model={model}
            onHarnessChange={setAgentHarness}
            onModelChange={setModel}
          />
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 text-sm border-2 border-chatroom-border text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-none transition-colors"
          >
            Cancel
          </button>

          {isEnhancerConfigActive(initialConfig) && (
            <button
              type="button"
              onClick={() => {
                onDisable();
                onOpenChange(false);
              }}
              className="px-3 py-1.5 text-sm border-2 border-chatroom-status-error/40 text-chatroom-status-error hover:bg-chatroom-status-error/10 rounded-none transition-colors"
            >
              Disable
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canEnable}
            className="px-3 py-1.5 text-sm bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Enable
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
