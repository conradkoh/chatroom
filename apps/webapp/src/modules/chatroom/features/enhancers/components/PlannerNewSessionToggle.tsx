'use client';
import { useCallback } from 'react';

import { PlannerNewSessionToggleButton } from './PlannerNewSessionToggleButton';
import { useComposerPreflightShortcut } from '../../../hooks/useComposerPreflightShortcut';
import { useStartInNewSessionPreference } from '../../../hooks/useStartInNewSessionPreference';

export function PlannerNewSessionToggle() {
  const { startInNewSession, setStartInNewSession } = useStartInNewSessionPreference();
  const onToggle = useCallback(
    () => setStartInNewSession(!startInNewSession),
    [startInNewSession, setStartInNewSession]
  );
  useComposerPreflightShortcut({ code: 'KeyN', onTrigger: onToggle });

  return <PlannerNewSessionToggleButton isActive={startInNewSession} onToggle={onToggle} />;
}
