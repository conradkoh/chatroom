'use client';
import { createContext, useContext } from 'react';
export interface PickerShellContextValue { mobileKeyboardOpen: boolean }
const PickerShellContext = createContext<PickerShellContextValue>({ mobileKeyboardOpen: false });
export const PickerShellProvider = PickerShellContext.Provider;
export function usePickerShell(): PickerShellContextValue { return useContext(PickerShellContext); }
