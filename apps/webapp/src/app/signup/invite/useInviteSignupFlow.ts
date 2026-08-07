import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { formatCodeInputValue } from '@/modules/auth/formatCodeInput';

type PageState = 'entry' | 'validating' | 'success' | 'error';

export function useInviteSignupFlow() {
  const validateInviteCode = useSessionMutation(api.system.invites.validateInviteCode);
  const [code, setCode] = useState('');
  const [pageState, setPageState] = useState<PageState>('entry');
  const [error, setError] = useState<string | null>(null);
  const [inviteeName, setInviteeName] = useState<string | null>(null);

  const handleCodeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setCode(formatCodeInputValue(e.target.value));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const cleanCode = code.replace(/-/g, '').trim();
      if (cleanCode.length !== 8) {
        setError('Please enter a valid 8-character invite code');
        setPageState('error');
        return;
      }

      setPageState('validating');
      setError(null);

      try {
        const result = await validateInviteCode({ code: cleanCode });
        if (result.valid) {
          setInviteeName(result.inviteeName);
          setPageState('success');
          return;
        }
        setError(result.message);
        setPageState('error');
      } catch {
        setError('An unexpected error occurred. Please try again.');
        setPageState('error');
      }
    },
    [code, validateInviteCode]
  );

  return {
    code,
    pageState,
    error,
    inviteeName,
    handleCodeChange,
    handleSubmit,
  };
}
