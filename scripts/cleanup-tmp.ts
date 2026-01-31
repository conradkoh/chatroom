#!/usr/bin/env node

/**
 * Clean up consumed tmp/chatroom files
 *
 * This script automatically removes temporary files that have been consumed
 * by the chatroom system to prevent file system bloat.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const TMP_DIR = path.join(PROJECT_ROOT, 'tmp', 'chatroom');

// File patterns that indicate consumed files
const CONSUMED_PATTERNS = [
  /^message-\d+\.md$/, // Handoff messages
  /^approval-\d+\.md$/, // Approval messages
  /^feedback-\d+\.md$/, // Feedback messages
  /^review-\d+\.md$/, // Review messages
  /^handoff-\d+\.md$/, // Handoff messages
  /^task\d+-review\.md$/, // Task review files
  /^analysis-.*\.md$/, // Analysis files
  /^implementation-.*\.md$/, // Implementation files
  /^artifact-.*\.md$/, // Artifact-related files
];

/**
 * Check if a file appears to be consumed (old enough to be processed)
 */
function isConsumedFile(filePath: string, fileName: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    const fileAge = Date.now() - stats.mtime.getTime();
    const fileAgeHours = fileAge / (1000 * 60 * 60);

    // File is consumed if it's older than 2 hours and matches a pattern
    const isOldEnough = fileAgeHours > 2;
    const matchesPattern = CONSUMED_PATTERNS.some((pattern) => pattern.test(fileName));

    return isOldEnough && matchesPattern;
  } catch {
    return false;
  }
}

/**
 * Clean up consumed temporary files
 */
function cleanupTmpFiles(): void {
  if (!fs.existsSync(TMP_DIR)) {
    console.log('📁 tmp/chatroom directory does not exist');
    return;
  }

  try {
    const files = fs.readdirSync(TMP_DIR);
    let cleanedCount = 0;
    let totalSize = 0;

    for (const file of files) {
      const filePath = path.join(TMP_DIR, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && isConsumedFile(filePath, file)) {
        try {
          totalSize += stat.size;
          fs.unlinkSync(filePath);
          cleanedCount++;
          console.log(`🗑️  Removed: ${file}`);
        } catch (err) {
          console.error(`❌ Failed to remove ${file}: ${(err as Error).message}`);
        }
      }
    }

    if (cleanedCount > 0) {
      const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
      console.log(``);
      console.log(`✅ Cleanup complete:`);
      console.log(`   Files removed: ${cleanedCount}`);
      console.log(`   Space freed: ${sizeMB} MB`);
      console.log(`   Directory: ${TMP_DIR}`);
    } else {
      console.log(`✅ No consumed files to clean up`);
    }
  } catch (err) {
    console.error(`❌ Cleanup failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

// Main execution
function main(): void {
  console.log('🧹 Cleaning up consumed tmp/chatroom files...');
  console.log('');

  cleanupTmpFiles();

  console.log('');
  console.log('💡 To run this manually: npm run cleanup-tmp');
  console.log('💡 Files newer than 2 hours are preserved');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { cleanupTmpFiles };
