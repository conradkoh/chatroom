import { describe, expect, it } from 'vitest';

import { getBlockedUploadTargetReason } from './workspace-upload-path-policy';

describe('workspace-upload-path-policy', () => {
  it('blocks .git paths', () => {
    expect(getBlockedUploadTargetReason('.git/config')).toMatch(/blocked/i);
    expect(getBlockedUploadTargetReason('src/.git/hooks/pre-commit')).toMatch(/blocked/i);
    expect(getBlockedUploadTargetReason('.Git/config')).toMatch(/blocked/i);
  });

  it('blocks secret paths', () => {
    expect(getBlockedUploadTargetReason('.env')).toMatch(/blocked/i);
    expect(getBlockedUploadTargetReason('packages/app/.env.local')).toMatch(/blocked/i);
    expect(getBlockedUploadTargetReason('src/secrets/token.txt')).toMatch(/blocked/i);
    expect(getBlockedUploadTargetReason('certs/server.pem')).toMatch(/blocked/i);
  });

  it('allows normal workspace paths', () => {
    expect(getBlockedUploadTargetReason('docs/spec.pdf')).toBeNull();
    expect(getBlockedUploadTargetReason('src/components/App.tsx')).toBeNull();
    expect(getBlockedUploadTargetReason('docs/environment.md')).toBeNull();
  });
});
