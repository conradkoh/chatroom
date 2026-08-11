export type OAuthFlowType = 'login' | 'connect';

export function createOAuthState(
  flowType: OAuthFlowType,
  requestId: string,
  returnTo?: string
): string {
  return encodeURIComponent(
    JSON.stringify({
      flowType,
      requestId,
      version: 'v1',
      ...(returnTo ? { returnTo } : {}),
    })
  );
}

function parseOAuthStateReturnTo(encodedState: string): string | undefined {
  try {
    const parsed = JSON.parse(decodeURIComponent(encodedState)) as { returnTo?: string };
    return typeof parsed.returnTo === 'string' ? parsed.returnTo : undefined;
  } catch {
    return undefined;
  }
}

function getDefaultOAuthReturnTo(flowType: OAuthFlowType): string {
  return flowType === 'connect' ? '/app/profile' : '/login';
}

function parseOAuthStateFlowType(encodedState: string): OAuthFlowType | undefined {
  try {
    const parsed = JSON.parse(decodeURIComponent(encodedState)) as { flowType?: OAuthFlowType };
    return parsed.flowType;
  } catch {
    return undefined;
  }
}

export function getOAuthCallbackReturnTo(
  encodedState: string | undefined,
  flowType: OAuthFlowType = 'login'
): string | undefined {
  if (!encodedState) return undefined;

  const returnTo = parseOAuthStateReturnTo(encodedState);
  if (returnTo) return returnTo;

  return getDefaultOAuthReturnTo(parseOAuthStateFlowType(encodedState) ?? flowType);
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

export function redirectToGoogleOAuth(authUrl: string): void {
  window.location.assign(authUrl);
}
