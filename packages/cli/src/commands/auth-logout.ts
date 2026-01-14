/**
 * Auth logout command
 * Clears CLI authentication
 */

import { clearAuthData, getAuthFilePath, isAuthenticated } from '../infrastructure/auth/storage.js';

export async function authLogout(): Promise<void> {
  if (!isAuthenticated()) {
    console.log(`ℹ️  Not currently authenticated.`);
    return;
  }

  const cleared = clearAuthData();

  if (cleared) {
    console.log(`✅ Logged out successfully.`);
    console.log(`   Removed: ${getAuthFilePath()}`);
  } else {
    console.error(`❌ Failed to clear authentication data.`);
    process.exit(1);
  }
}
