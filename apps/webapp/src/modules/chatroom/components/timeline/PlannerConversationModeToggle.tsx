'use client';

import { nextConversationMode } from '@workspace/shared/domain/conversation-mode';
import { useCallback } from 'react';

import { PlannerConversationModeToggleButton } from './PlannerConversationModeToggleButton';
import { useComposerPreflightShortcut } from '../../hooks/useComposerPreflightShortcut';
import { useConversationMode } from '../../hooks/useConversationMode';

export function PlannerConversationModeToggle({
  onRequestComposerFocus,
}: {
  onRequestComposerFocus?: () => void;
}) {
  const { mode, setMode } = useConversationMode();
  const onCycle = useCallback(() => {
    setMode(nextConversationMode(mode));
    onRequestComposerFocus?.();
  }, [mode, onRequestComposerFocus, setMode]);

  useComposerPreflightShortcut({ code: 'KeyM', onTrigger: onCycle });

  return <PlannerConversationModeToggleButton mode={mode} onCycle={onCycle} />;
}
