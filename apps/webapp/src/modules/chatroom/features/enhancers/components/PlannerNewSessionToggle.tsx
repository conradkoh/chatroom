'use client';
import { useCallback } from 'react';

import { PlannerNewSessionToggleButton } from './PlannerNewSessionToggleButton';
import { useAltShortcut } from '../../../hooks/useAltShortcut';
import { useStartInNewSessionPreference } from '../../../hooks/useStartInNewSessionPreference';

export function PlannerNewSessionToggle() {
  const { startInNewSession, setStartInNewSession } = useStartInNewSessionPreference();
  const onToggle = useCallback(
    () => setStartInNewSession(!startInNewSession),
    [startInNewSession, setStartInNewSession]
  );
  useAltShortcut({ code: 'KeyN', onTrigger: onToggle });

  return <PlannerNewSessionToggleButton isActive={startInNewSession} onToggle={onToggle} />;
}
