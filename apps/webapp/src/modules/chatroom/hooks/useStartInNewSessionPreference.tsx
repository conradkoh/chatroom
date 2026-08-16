'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';

const Ctx = createContext<{
  startInNewSession: boolean;
  setStartInNewSession: (v: boolean) => void;
} | null>(null);
export function StartInNewSessionPreferenceProvider({ children }: { children: ReactNode }) {
  const [startInNewSession, setStartInNewSession] = useState(false);
  return (
    <Ctx.Provider value={{ startInNewSession, setStartInNewSession }}>{children}</Ctx.Provider>
  );
}
export function useStartInNewSessionPreference() {
  return useContext(Ctx) ?? { startInNewSession: false, setStartInNewSession: () => {} };
}
