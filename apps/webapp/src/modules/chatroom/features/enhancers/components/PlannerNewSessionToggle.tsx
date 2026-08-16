'use client';
import { PlannerNewSessionToggleButton } from './PlannerNewSessionToggleButton';
import { useStartInNewSessionPreference } from '../../../hooks/useStartInNewSessionPreference';

export function PlannerNewSessionToggle() {
  const { startInNewSession, setStartInNewSession } = useStartInNewSessionPreference();
  return (
    <PlannerNewSessionToggleButton
      isActive={startInNewSession}
      onToggle={() => setStartInNewSession(!startInNewSession)}
    />
  );
}
