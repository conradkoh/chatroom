export type GoogleOAuthFlowType = 'login' | 'connect';

/** Maps OAuth/server error text to a user-facing message. */
// fallow-ignore-next-line complexity
export function getGoogleOAuthUserFriendlyError(
  errorMessage: string,
  flowType: GoogleOAuthFlowType = 'login'
): string {
  const lowerError = errorMessage.toLowerCase();

  if (lowerError.includes('access_denied')) {
    return 'You cancelled the authentication process.';
  }
  if (lowerError.includes('expired')) {
    return 'The authentication request has expired. Please try again.';
  }
  if (lowerError.includes('invalid') || lowerError.includes('state')) {
    return 'The authentication request is invalid. Please start the process again.';
  }
  if (lowerError.includes('already_connected') || lowerError.includes('already connected')) {
    return 'This Google account is already connected to your profile.';
  }
  if (lowerError.includes('email_already_exists') || lowerError.includes('email already exists')) {
    return 'An account with this email already exists. Please try signing in instead.';
  }
  if (lowerError.includes('feature_disabled')) {
    return 'Google authentication is currently unavailable. Please try again later.';
  }
  if (lowerError.includes('network') || lowerError.includes('fetch')) {
    return 'Network error occurred. Please check your connection and try again.';
  }

  return flowType === 'connect'
    ? 'Unable to connect your Google account. Please try again.'
    : 'Unable to sign in with Google. Please try again.';
}
