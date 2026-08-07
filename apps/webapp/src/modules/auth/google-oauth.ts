export type OAuthFlowType = 'login' | 'connect';

export function createOAuthState(flowType: OAuthFlowType, requestId: string): string {
  return encodeURIComponent(JSON.stringify({ flowType, requestId, version: 'v1' }));
}

export function buildGoogleOAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: params.state,
    prompt: 'consent',
    access_type: 'offline',
  })}`;
}

export const GOOGLE_OAUTH_POPUP_FEATURES =
  'width=500,height=600,scrollbars=yes,resizable=yes,status=yes,location=yes,toolbar=no,menubar=no';

export const GOOGLE_OAUTH_POPUP_TIMEOUT_MS = 15 * 60 * 1000;
