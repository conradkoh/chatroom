'use client';

import type React from 'react';
import { createContext, useCallback, useContext, useEffect, useReducer, useRef } from 'react';

import { verifyPassword } from './password-utils';

export interface PasswordProtectConfig {
  verifyHash: string;
  salt: string;
  localStorageKey: string;
}

export interface PasswordProtectContextValue {
  isAuthorized: boolean;
  isLoading: boolean;
  error: string;
  authenticate: (password: string) => Promise<boolean>;
  logout: () => void;
  temporarilyHide: () => void;
  unhide: () => void;
  isTemporarilyHidden: boolean;
}

const PasswordProtectContext = createContext<PasswordProtectContextValue | null>(null);

export interface PasswordProtectProviderProps {
  config: PasswordProtectConfig;
  children: React.ReactNode;
}

type AuthAction =
  | { type: 'INIT_COMPLETE'; authorized: boolean }
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS' }
  | { type: 'AUTH_FAIL'; error: string }
  | { type: 'LOGOUT' }
  | { type: 'TEMPORARILY_HIDE' }
  | { type: 'UNHIDE' };

interface AuthState {
  isAuthorized: boolean;
  isLoading: boolean;
  isTemporarilyHidden: boolean;
  error: string;
}

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'INIT_COMPLETE':
      return { ...state, isAuthorized: action.authorized, isLoading: false };
    case 'AUTH_START':
      return { ...state, isLoading: true, error: '' };
    case 'AUTH_SUCCESS':
      return { ...state, isAuthorized: true, isLoading: false };
    case 'AUTH_FAIL':
      return { ...state, isLoading: false, error: action.error };
    case 'LOGOUT':
      return { ...state, isAuthorized: false, isTemporarilyHidden: false, error: '' };
    case 'TEMPORARILY_HIDE':
      return { ...state, isTemporarilyHidden: true };
    case 'UNHIDE':
      return { ...state, isTemporarilyHidden: false };
  }
}

const initialAuthState: AuthState = {
  isAuthorized: false,
  isLoading: true,
  isTemporarilyHidden: false,
  error: '',
};

export function PasswordProtectProvider({ config, children }: PasswordProtectProviderProps) {
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const initRef = useRef(false);

  const { verifyHash, salt, localStorageKey } = config;

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const checkStoredPassword = async () => {
      try {
        const storedPassword = localStorage.getItem(localStorageKey);
        if (storedPassword) {
          const isValid = await verifyPassword(storedPassword, verifyHash, salt);
          if (isValid) {
            dispatch({ type: 'INIT_COMPLETE', authorized: true });
            return;
          }
          localStorage.removeItem(localStorageKey);
        }
      } catch (err) {
        console.error('Error checking stored password:', err);
        localStorage.removeItem(localStorageKey);
      }
      dispatch({ type: 'INIT_COMPLETE', authorized: false });
    };

    checkStoredPassword();
  }, [localStorageKey, verifyHash, salt]);

  const authenticate = useCallback(
    async (password: string): Promise<boolean> => {
      dispatch({ type: 'AUTH_START' });

      try {
        const isValid = await verifyPassword(password, verifyHash, salt);
        if (isValid) {
          localStorage.setItem(localStorageKey, password);
          dispatch({ type: 'AUTH_SUCCESS' });
          return true;
        }

        dispatch({ type: 'AUTH_FAIL', error: 'Incorrect password. Please try again.' });
        return false;
      } catch (err) {
        dispatch({
          type: 'AUTH_FAIL',
          error: 'An error occurred while verifying the password.',
        });
        console.error('Password verification error:', err);
        return false;
      }
    },
    [verifyHash, salt, localStorageKey]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(localStorageKey);
    dispatch({ type: 'LOGOUT' });
  }, [localStorageKey]);

  const temporarilyHide = useCallback(() => {
    dispatch({ type: 'TEMPORARILY_HIDE' });
  }, []);

  const unhide = useCallback(() => {
    dispatch({ type: 'UNHIDE' });
  }, []);

  const contextValue: PasswordProtectContextValue = {
    isAuthorized: state.isAuthorized,
    isLoading: state.isLoading,
    error: state.error,
    authenticate,
    logout,
    temporarilyHide,
    unhide,
    isTemporarilyHidden: state.isTemporarilyHidden,
  };

  return (
    <PasswordProtectContext.Provider value={contextValue}>
      {children}
    </PasswordProtectContext.Provider>
  );
}

export function usePasswordProtection(): PasswordProtectContextValue {
  const context = useContext(PasswordProtectContext);
  if (!context) {
    throw new Error('usePasswordProtection must be used within a PasswordProtectProvider');
  }
  return context;
}
