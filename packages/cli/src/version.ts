/**
 * CLI Version Utility
 *
 * Reads the version from package.json to ensure consistency
 * between the CLI output and the published package version.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Get the CLI version from package.json
 *
 * This function reads the version at runtime from the package.json file.
 * It handles both development (source) and production (dist) paths.
 */
export function getVersion(): string {
  try {
    // Get the directory of this file
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Try to find package.json - could be in parent dir (from src/) or two levels up (from dist/)
    const possiblePaths = [
      join(__dirname, '..', 'package.json'), // From src/version.ts -> package.json
      join(__dirname, '..', '..', 'package.json'), // From dist/version.js -> package.json
    ];

    for (const packagePath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
        if (packageJson.version) {
          return packageJson.version;
        }
      } catch {
        // Try next path
      }
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}
