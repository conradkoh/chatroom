import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type PageState = 'entry' | 'validating' | 'success' | 'error';

// fallow-ignore-next-line complexity
export function InviteCodeForm({
  code,
  error,
  pageState,
  onCodeChange,
  onSubmit,
}: {
  code: string;
  error: string | null;
  pageState: PageState;
  onCodeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Input
          id="invite-code"
          type="text"
          placeholder="XXXX-XXXX"
          value={code}
          onChange={onCodeChange}
          className="text-center font-mono text-lg tracking-widest uppercase"
          maxLength={9}
          autoComplete="off"
          disabled={pageState === 'validating'}
          aria-label="Enter invite code"
          aria-describedby={error ? 'invite-code-error' : 'invite-code-hint'}
          aria-invalid={error ? true : undefined}
        />
        {error ? (
          <p id="invite-code-error" className="text-sm text-destructive text-center" role="alert">
            {error}
          </p>
        ) : (
          <p id="invite-code-hint" className="text-xs text-muted-foreground text-center">
            Enter the 8-character invite code you received
          </p>
        )}
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={pageState === 'validating'}
        aria-busy={pageState === 'validating'}
      >
        {pageState === 'validating' ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            <span>Validating...</span>
          </>
        ) : (
          'Continue'
        )}
      </Button>
    </form>
  );
}
