import { GoogleLoginButton } from '@/modules/auth/GoogleLoginButton';

export function InviteSuccessPanel({ inviteeName }: { inviteeName: string }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-center">
        Welcome, {inviteeName}! Continue with Google to create your account.
      </p>
      <GoogleLoginButton className="w-full" />
    </div>
  );
}
