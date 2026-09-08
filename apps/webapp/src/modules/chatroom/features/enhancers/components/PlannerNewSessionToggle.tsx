'use client';
import { useCallback } from 'react';

import { PlannerNewSessionToggleButton } from './PlannerNewSessionToggleButton';
import { useComposerPreflightShortcut } from '../../../hooks/useComposerPreflightShortcut';
import { useStartInNewSessionPreference } from '../../../hooks/useStartInNewSessionPreference';

interface PlannerNewSessionToggleProps {
  onRequestComposerFocus?: () => void;
}

export function PlannerNewSessionToggle({
  onRequestComposerFocus,
}: PlannerNewSessionToggleProps = {}) {
  const { startInNewSession, setStartInNewSession } = useStartInNewSessionPreference();
  const onToggle = useCallback(
    () => setStartInNewSession(!startInNewSession),
    [startInNewSession, setStartInNewSession]
  );
  const handleShortcut = useCallback(() => {
    onToggle();
    onRequestComposerFocus?.();
  }, [onRequestComposerFocus, onToggle]);
  useComposerPreflightShortcut({ code: 'KeyN', onTrigger: handleShortcut });

  return <PlannerNewSessionToggleButton isActive={startInNewSession} onToggle={onToggle} />;
}
