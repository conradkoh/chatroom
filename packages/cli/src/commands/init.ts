/**
 * Initialize chatroom configuration
 */

import * as readline from 'readline';

import { DEFAULT_CONVEX_URL } from '../config/defaults.js';
import { findConfigPath, createGlobalConfig } from '../config/loader.js';

interface InitOptions {
  force?: boolean;
}

/**
 * Prompt user for input
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
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

  console.log('Chatroom CLI needs a Convex backend to store messages.');
  console.log('You can use your own deployment or a shared instance.\n');

  console.log(`Default Convex URL: ${DEFAULT_CONVEX_URL}`);
  console.log('(Press Enter to use the default, or enter your own URL)\n');

  const userInput = await prompt('Convex URL: ');
  const convexUrl = userInput || DEFAULT_CONVEX_URL;

  console.log(`\n✅ Using Convex URL: ${convexUrl}`);

  // Create the global config
  const configPath = createGlobalConfig(convexUrl);

  console.log(`\n📋 Configuration saved to: ${configPath}`);
  console.log('\nYou can edit this file later to customize teams and prompts.');
}
