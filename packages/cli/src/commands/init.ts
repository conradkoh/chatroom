/**
 * Initialize chatroom configuration
 */

import { findConfigPath, createGlobalConfig } from '../config/loader.js';
import { CONVEX_URL } from '../infrastructure/convex/client.js';

interface InitOptions {
  force?: boolean;
}

export async function initConfig(options: InitOptions): Promise<void> {
  // Check if config already exists
  const existingConfigPath = findConfigPath();

  if (existingConfigPath && !options.force) {
    console.log(`✅ Configuration already exists at: ${existingConfigPath}`);
    console.log('   Use --force to overwrite');
    return;
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           🎉 Welcome to Chatroom CLI Setup! 🎉          ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  console.log(`Chatroom CLI connects to: ${CONVEX_URL}\n`);

  // Create the global config
  const configPath = createGlobalConfig();

  console.log(`📋 Configuration saved to: ${configPath}`);
  console.log('\nYou can edit this file to customize teams and prompts.');
}
