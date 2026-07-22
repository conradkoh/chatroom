#!/usr/bin/env bun

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { TEMPLATE_REPO_URL, parseGitHubOwnerRepo } from './template-repo';
import { updateCliConfig } from './update-cli-config';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendEnvPath = join(scriptDir, '..', 'services', 'backend', '.env.local');
const webappEnvPath = join(scriptDir, '..', 'apps', 'webapp', '.env.local');

type CliArgs = {
  skipBranding: boolean;
  nonInteractive: boolean;
  appName: string | null;
  appShortName: string | null;
  appDescription: string | null;
  landingPageTitle: string | null;
  packageName: string | null;
  repoUrl: string | null;
  help: boolean;
};

type BrandingOptions = {
  appName?: string | null;
  appShortName?: string | null;
  appDescription?: string | null;
  landingPageTitle?: string | null;
  packageName?: string | null;
};

type FileBrandingResult = {
  exists: boolean;
  hasTemplate: boolean;
  content?: string;
};

type BrandingStatus = {
  manifest: FileBrandingResult;
  layout: FileBrandingResult;
  navigation: FileBrandingResult;
  landingPage: FileBrandingResult;
  rootPackageJson: FileBrandingResult;
};

const args = process.argv.slice(2);
const cliArgs: CliArgs = {
  skipBranding: args.includes('--skip-branding'),
  nonInteractive: args.includes('--non-interactive') || args.includes('-y'),
  appName: getArgValue(args, '--app-name'),
  appShortName: getArgValue(args, '--app-short-name'),
  appDescription: getArgValue(args, '--app-description'),
  landingPageTitle: getArgValue(args, '--landing-page-title'),
  packageName: getArgValue(args, '--package-name'),
  repoUrl: getArgValue(args, '--repo-url'),
  help: args.includes('--help') || args.includes('-h'),
};

function getArgValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index !== -1 && index + 1 < argv.length) {
    return argv[index + 1];
  }
  return null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showHelp(): void {
  console.log(`
Usage: bun scripts/setup.ts [OPTIONS]

Setup script for Next Convex Starter App. Initializes Convex backend and
configures application branding.

OPTIONS:
  --help, -h                    Show this help message
  --skip-branding               Skip branding setup entirely
  --non-interactive, -y         Run in non-interactive mode (skip prompts)
  --repo-url <url>              GitHub repository URL (e.g. https://github.com/owner/repo)
  
  Branding Options (requires --non-interactive):
  --app-name <name>             Full application name
  --app-short-name <name>       Short application name (for navigation)
  --app-description <desc>      Application description
  --landing-page-title <title>  Landing page title
  --package-name <name>         Package name (lowercase, hyphens only)

EXAMPLES:
  # Interactive mode (default)
  bun scripts/setup.ts
  
  # Skip branding setup
  bun scripts/setup.ts --skip-branding
  
  # Non-interactive mode with branding
  bun scripts/setup.ts --non-interactive \\
    --app-name "My Awesome App" \\
    --app-short-name "MyApp" \\
    --app-description "My app description" \\
    --landing-page-title "Welcome to My App" \\
    --package-name "my-awesome-app"
  
  # Non-interactive mode, skip branding if already configured
  bun scripts/setup.ts -y

NOTES:
  - The script is idempotent and safe to run multiple times
  - In non-interactive mode without branding options, branding setup is skipped
  - Branding is only updated if template values are detected
`);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const BRANDING_CONFIG = {
  templates: {
    appName: 'Next Convex App',
    appShortName: 'Next Convex',
    appDescription: 'A Next.js app with Convex backend',
    packageName: 'next-convex-starter-app',
    landingPageTitle: 'Convex + Next Starter App',
  },
  files: {
    manifest: join(scriptDir, '..', 'apps', 'webapp', 'src', 'app', 'manifest.ts'),
    layout: join(scriptDir, '..', 'apps', 'webapp', 'src', 'app', 'layout.tsx'),
    navigation: join(scriptDir, '..', 'apps', 'webapp', 'src', 'components', 'Navigation.tsx'),
    landingPage: join(scriptDir, '..', 'apps', 'webapp', 'src', 'app', 'page.tsx'),
    rootPackageJson: join(scriptDir, '..', 'package.json'),
    webappPackageJson: join(scriptDir, '..', 'apps', 'webapp', 'package.json'),
  },
};

function initConvexDirect(): boolean {
  console.log('⚙️  Initializing Convex backend...');
  console.log('This will prompt you to log in to Convex and create a new project if needed.');

  try {
    const result = spawnSync('npx', ['convex', 'dev', '--once'], {
      cwd: join(scriptDir, '..', 'services', 'backend'),
      stdio: 'inherit',
    });

    if (result.status === 0) {
      console.log('✅ Backend initialization completed successfully.');
      return true;
    }
    console.error('❌ Backend initialization failed.');
    return false;
  } catch (error) {
    console.error('❌ Error initializing Convex backend:', getErrorMessage(error));
    return false;
  }
}

function getConvexUrl(): string {
  if (!existsSync(backendEnvPath)) {
    console.error('❌ Error: Backend .env.local file not found.');
    console.error('Please run the initialization command in the services/backend directory first.');
    process.exit(1);
  }

  const envContent = readFileSync(backendEnvPath, 'utf8');
  const match = envContent.match(/CONVEX_URL=(.+)/);

  if (!match?.[1]) {
    console.error('❌ Error: CONVEX_URL not found in the backend .env.local file.');
    process.exit(1);
  }

  return match[1].trim();
}

function generateRandomPort(): number {
  const MIN_PORT = 3000;
  const MAX_PORT = 9999;
  return Math.floor(Math.random() * (MAX_PORT - MIN_PORT + 1)) + MIN_PORT;
}

function updateEnvVariable(envContent: string, key: string, value: string | number): string {
  const regex = new RegExp(`^${key}=.+$`, 'm');
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${value}`);
  }

  const separator = envContent && !envContent.endsWith('\n') ? '\n' : '';
  return `${envContent}${separator}${key}=${value}\n`;
}

function setupWebappEnv(convexUrl: string): void {
  const webappEnvDir = dirname(webappEnvPath);
  if (!existsSync(webappEnvDir)) {
    mkdirSync(webappEnvDir, { recursive: true });
  }

  let envContent = existsSync(webappEnvPath) ? readFileSync(webappEnvPath, 'utf8') : '';
  envContent = updateEnvVariable(envContent, 'NEXT_PUBLIC_CONVEX_URL', convexUrl);
  envContent = updateEnvVariable(envContent, 'NEXT_PUBLIC_LOCAL_MANAGER_PORT', '3847');

  if (!envContent.match(/^PORT=/m)) {
    const randomPort = generateRandomPort();
    envContent = updateEnvVariable(envContent, 'PORT', randomPort);
    console.log(`🔧 Generated random port: ${randomPort}`);
  } else {
    console.log('✅ PORT already configured in .env.local');
  }

  writeFileSync(webappEnvPath, envContent);
}

function addUpstreamRemote(): void {
  console.log('🔗 Checking for existing upstream remote repository...');
  try {
    const remotes = execSync('git remote -v').toString();
    if (remotes.includes('upstream')) {
      console.log('⚠️ Upstream remote already exists. Skipping this step.');
      return;
    }

    execSync(`git remote add upstream ${TEMPLATE_REPO_URL}`, {
      stdio: 'inherit',
    });
    console.log('✅ Upstream remote added successfully.');
  } catch (error) {
    console.error('❌ Error adding upstream remote:', getErrorMessage(error));
  }
}

function isGhCliAvailable(): boolean {
  try {
    execSync('command -v gh', { stdio: 'pipe' });
    return true;
  } catch {
    try {
      execSync('gh --version', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }
}

function skipGitHubRepoInNonInteractive(): null {
  console.log(
    '⏭️  Non-interactive mode: skipping GitHub repo configuration (no --repo-url provided).\n'
  );
  return null;
}

async function promptForGitHubRepoUrl(): Promise<string | null> {
  const githubRepoUrl = await promptUser(
    'Enter your GitHub repository URL (e.g. https://github.com/owner/repo)',
    ''
  );

  if (!githubRepoUrl) {
    console.log('⏭️  No repository URL provided. Skipping GitHub repo configuration.\n');
    return null;
  }

  return githubRepoUrl;
}

async function resolveGitHubRepoUrl(
  nonInteractive: boolean,
  repoUrl: string | null
): Promise<string | null> {
  if (repoUrl) {
    return repoUrl;
  }

  if (nonInteractive) {
    return skipGitHubRepoInNonInteractive();
  }

  return promptForGitHubRepoUrl();
}

function configureOriginRemote(githubRepoUrl: string): void {
  try {
    const remotes = execSync('git remote -v').toString();
    if (remotes.includes('origin')) {
      execSync(`git remote set-url origin ${githubRepoUrl}`, { stdio: 'inherit' });
      console.log(`✅ Updated origin remote to ${githubRepoUrl}`);
      return;
    }

    execSync(`git remote add origin ${githubRepoUrl}`, { stdio: 'inherit' });
    console.log(`✅ Added origin remote: ${githubRepoUrl}`);
  } catch (error) {
    console.error('❌ Error configuring origin remote:', getErrorMessage(error));
  }
}

function setUpstreamTrackingBranch(): void {
  try {
    execSync('git branch --set-upstream-to=origin/master', { stdio: 'inherit' });
    console.log('✅ Set upstream tracking branch to origin/master');
  } catch (error) {
    console.warn(`⚠️  Could not set upstream tracking branch: ${getErrorMessage(error)}`);
    console.warn('   This is expected if you have not pushed to the remote yet.');
  }
}

function configureGhDefaultRepo(ownerRepo: string): void {
  if (isGhCliAvailable()) {
    try {
      execSync(`gh repo set-default ${ownerRepo}`, { stdio: 'inherit' });
      console.log(`✅ Set gh CLI default repo to ${ownerRepo}`);
    } catch (error) {
      console.error(`❌ Error setting gh CLI default repo: ${getErrorMessage(error)}`);
    }
    return;
  }

  console.log('ℹ️  gh CLI not found — skipping gh repo set-default.');
  console.log(
    `   Install the GitHub CLI (https://cli.github.com/) and run: gh repo set-default ${ownerRepo}`
  );
}

async function configureGitHubRepo(
  nonInteractive = false,
  repoUrl: string | null = null
): Promise<void> {
  console.log('\n🐙 GitHub Repository Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const githubRepoUrl = await resolveGitHubRepoUrl(nonInteractive, repoUrl);
  if (!githubRepoUrl) {
    return;
  }

  const parsed = parseGitHubOwnerRepo(githubRepoUrl);
  if (!parsed) {
    console.error(
      '❌ Could not parse GitHub owner/repo from the provided URL. Skipping GitHub repo configuration.'
    );
    return;
  }

  configureOriginRemote(githubRepoUrl);
  setUpstreamTrackingBranch();
  configureGhDefaultRepo(`${parsed.owner}/${parsed.repo}`);
  console.log('');
}

function promptUser(question: string, defaultValue: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultValue}]: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

function checkFileBranding(filePath: string, searchStrings: string[]): FileBrandingResult {
  if (!existsSync(filePath)) {
    return { exists: false, hasTemplate: false };
  }

  const content = readFileSync(filePath, 'utf8');
  const hasTemplate = searchStrings.some((str) => content.includes(str));

  return { exists: true, hasTemplate, content };
}

function detectBrandingStatus(): BrandingStatus {
  return {
    manifest: checkFileBranding(BRANDING_CONFIG.files.manifest, [
      BRANDING_CONFIG.templates.appName,
      BRANDING_CONFIG.templates.appShortName,
      BRANDING_CONFIG.templates.appDescription,
    ]),
    layout: checkFileBranding(BRANDING_CONFIG.files.layout, [
      BRANDING_CONFIG.templates.appName,
      BRANDING_CONFIG.templates.appDescription,
    ]),
    navigation: checkFileBranding(BRANDING_CONFIG.files.navigation, [
      BRANDING_CONFIG.templates.appShortName,
    ]),
    landingPage: checkFileBranding(BRANDING_CONFIG.files.landingPage, [
      BRANDING_CONFIG.templates.landingPageTitle,
    ]),
    rootPackageJson: checkFileBranding(BRANDING_CONFIG.files.rootPackageJson, [
      BRANDING_CONFIG.templates.packageName,
    ]),
  };
}

function displayBrandingStatus(status: BrandingStatus): void {
  console.log('\n📋 Current Branding Status:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const items = [
    {
      label: 'PWA Manifest',
      status: status.manifest,
      file: 'apps/webapp/src/app/manifest.ts',
    },
    {
      label: 'App Layout (Title & Description)',
      status: status.layout,
      file: 'apps/webapp/src/app/layout.tsx',
    },
    {
      label: 'Navigation Header',
      status: status.navigation,
      file: 'apps/webapp/src/components/Navigation.tsx',
    },
    {
      label: 'Landing Page',
      status: status.landingPage,
      file: 'apps/webapp/src/app/page.tsx',
    },
    {
      label: 'Package Name',
      status: status.rootPackageJson,
      file: 'package.json',
    },
  ];

  for (const item of items) {
    const statusIcon = item.status.hasTemplate ? '⚠️  TEMPLATE' : '✅ CONFIGURED';
    const statusColor = item.status.hasTemplate ? '\x1b[33m' : '\x1b[32m';
    const resetColor = '\x1b[0m';

    console.log(`${statusColor}${statusIcon}${resetColor} ${item.label}`);
    console.log(`   ${item.file}`);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function needsBrandingUpdate(status: BrandingStatus): boolean {
  return Object.values(status).some((entry) => entry.hasTemplate);
}

function updateManifest(appName: string, appShortName: string, appDescription: string): void {
  const filePath = BRANDING_CONFIG.files.manifest;
  let content = readFileSync(filePath, 'utf8');

  content = content.replace(/name: ['"].*?['"]/, `name: '${appName}'`);
  content = content.replace(/short_name: ['"].*?['"]/, `short_name: '${appShortName}'`);
  content = content.replace(/description: ['"].*?['"]/, `description: '${appDescription}'`);

  writeFileSync(filePath, content);
}

function updateLayout(appName: string, appDescription: string): void {
  const filePath = BRANDING_CONFIG.files.layout;
  let content = readFileSync(filePath, 'utf8');

  content = content.replace(/title: ['"].*?['"]/, `title: '${appName}'`);
  content = content.replace(/description: ['"].*?['"]/, `description: '${appDescription}'`);
  content = content.replace(/appleWebApp:\s*\{[^}]*title: ['"].*?['"]/s, (match) =>
    match.replace(/title: ['"].*?['"]/, `title: '${appName}'`)
  );
  content = content.replace(/applicationName: ['"].*?['"]/, `applicationName: '${appName}'`);

  writeFileSync(filePath, content);
}

function updateNavigation(appShortName: string): void {
  const filePath = BRANDING_CONFIG.files.navigation;
  let content = readFileSync(filePath, 'utf8');

  content = content.replace(
    /<span className="font-bold text-lg">.*?<\/span>/,
    `<span className="font-bold text-lg">${appShortName}</span>`
  );

  writeFileSync(filePath, content);
}

function updateLandingPage(landingPageTitle: string): void {
  const filePath = BRANDING_CONFIG.files.landingPage;
  let content = readFileSync(filePath, 'utf8');

  content = content.replace(
    /(<main[^>]*>[\s\S]*?)\bConvex \+ Next Starter App\b/,
    `$1${landingPageTitle}`
  );

  writeFileSync(filePath, content);
}

function updatePackageJson(packageName: string): void {
  const filePath = BRANDING_CONFIG.files.rootPackageJson;
  const packageJson = JSON.parse(readFileSync(filePath, 'utf8')) as { name: string };

  packageJson.name = packageName;

  writeFileSync(filePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function slugifyPackageName(appName: string): string {
  return appName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');
}

type BrandingValues = {
  appName: string;
  appShortName: string;
  appDescription: string;
  landingPageTitle: string;
  packageName: string;
};

function defaultShortName(appName: string, shortName?: string | null): string {
  if (shortName) {
    return shortName;
  }

  return appName.length > 15 ? appName.substring(0, 15) : appName;
}

function buildBrandingFromOptions(
  appName: string,
  brandingOptions: BrandingOptions
): BrandingValues {
  return {
    appName,
    appShortName: defaultShortName(appName, brandingOptions.appShortName),
    appDescription: brandingOptions.appDescription ?? appName,
    landingPageTitle: brandingOptions.landingPageTitle ?? appName,
    packageName: brandingOptions.packageName ?? slugifyPackageName(appName),
  };
}

function logBrandingOptions(values: BrandingValues): void {
  console.log('Using provided branding options:');
  console.log(`  App Name: ${values.appName}`);
  console.log(`  Short Name: ${values.appShortName}`);
  console.log(`  Description: ${values.appDescription}`);
  console.log(`  Landing Page Title: ${values.landingPageTitle}`);
  console.log(`  Package Name: ${values.packageName}\n`);
}

function resolveNonInteractiveBranding(brandingOptions: BrandingOptions): BrandingValues | null {
  if (!brandingOptions.appName) {
    console.log('⚠️  Non-interactive mode requires branding options.');
    console.log('   Skipping branding setup. Run with --help for usage.\n');
    return null;
  }

  const values = buildBrandingFromOptions(brandingOptions.appName, brandingOptions);
  logBrandingOptions(values);
  return values;
}

async function resolveInteractiveBranding(): Promise<BrandingValues> {
  const appName = await promptUser('Full application name (for PWA & metadata)', 'My Awesome App');
  const appShortName = await promptUser(
    'Short application name (for navigation & PWA)',
    appName.length > 15 ? appName.substring(0, 15) : appName
  );
  const appDescription = await promptUser('Application description', appName);
  const landingPageTitle = await promptUser('Landing page title', appName);
  const packageName = await promptUser(
    'Package name (lowercase, hyphens only)',
    slugifyPackageName(appName)
  );

  return { appName, appShortName, appDescription, landingPageTitle, packageName };
}

async function resolveBrandingValues(
  nonInteractive: boolean,
  brandingOptions: BrandingOptions
): Promise<BrandingValues | null> {
  if (nonInteractive) {
    return resolveNonInteractiveBranding(brandingOptions);
  }

  return resolveInteractiveBranding();
}

async function setupBranding(
  nonInteractive = false,
  brandingOptions: BrandingOptions = {}
): Promise<void> {
  console.log('\n🎨 Branding Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (nonInteractive) {
    console.log('Running in non-interactive mode...\n');
  } else {
    console.log("Let's customize your app branding. Press Enter to keep the suggested values.\n");
  }

  const branding = await resolveBrandingValues(nonInteractive, brandingOptions);
  if (!branding) {
    return;
  }

  const { appName, appShortName, appDescription, landingPageTitle, packageName } = branding;

  console.log('\n📝 Updating branding across all files...');

  try {
    updateManifest(appName, appShortName, appDescription);
    console.log('✅ Updated PWA manifest');

    updateLayout(appName, appDescription);
    console.log('✅ Updated app layout metadata');

    updateNavigation(appShortName);
    console.log('✅ Updated navigation header');

    updateLandingPage(landingPageTitle);
    console.log('✅ Updated landing page');

    updatePackageJson(packageName);
    console.log('✅ Updated package.json');

    console.log('\n✅ Branding setup completed successfully!');
  } catch (error) {
    console.error('\n❌ Error updating branding:', getErrorMessage(error));
    throw error;
  }
}

async function handleNonInteractiveBrandingUpdate(): Promise<void> {
  const brandingOptions: BrandingOptions = {
    appName: cliArgs.appName,
    appShortName: cliArgs.appShortName,
    appDescription: cliArgs.appDescription,
    landingPageTitle: cliArgs.landingPageTitle,
    packageName: cliArgs.packageName,
  };

  if (!cliArgs.appName) {
    console.log('\n⏭️  Non-interactive mode without branding options.');
    console.log('   Skipping branding setup. Run with --help for usage.\n');
    return;
  }

  await setupBranding(true, brandingOptions);
}

async function handleInteractiveBrandingUpdate(): Promise<void> {
  const answer = await promptUser('\nWould you like to update the branding now? (yes/no)', 'yes');
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    await setupBranding();
    return;
  }

  console.log(
    '\n⏭️  Skipping branding setup. You can run this script again later to configure branding.'
  );
}

async function checkBranding(): Promise<void> {
  if (cliArgs.skipBranding) {
    console.log('\n⏭️  Skipping branding setup (--skip-branding flag).\n');
    return;
  }

  console.log('\n🔍 Checking application branding...');

  const status = detectBrandingStatus();
  displayBrandingStatus(status);

  if (!needsBrandingUpdate(status)) {
    console.log('✅ All branding appears to be configured!\n');
    return;
  }

  if (cliArgs.nonInteractive) {
    await handleNonInteractiveBrandingUpdate();
    return;
  }

  await handleInteractiveBrandingUpdate();
}

function ensureBackendEnv(): void {
  if (existsSync(backendEnvPath)) {
    console.log('✅ Backend .env.local already exists.');
    return;
  }

  const success = initConvexDirect();
  if (!success) {
    console.error('Could not initialize Convex. Please try running the setup manually.');
    process.exit(1);
  }
}

function disableNextTelemetry(): void {
  console.log('🔧 Disabling Next.js telemetry...');
  try {
    execSync('pnpm exec next telemetry disable', {
      stdio: 'inherit',
      cwd: join(scriptDir, '..', 'apps', 'webapp'),
    });
    console.log('✅ Next.js telemetry disabled successfully.');
  } catch (error) {
    console.error('❌ Error disabling Next.js telemetry:', getErrorMessage(error));
  }
}

async function setup(): Promise<void> {
  if (cliArgs.help) {
    showHelp();
    process.exit(0);
  }

  console.log('🚀 Starting project setup...');

  await checkBranding();
  ensureBackendEnv();
  addUpstreamRemote();
  await configureGitHubRepo(cliArgs.nonInteractive, cliArgs.repoUrl);
  disableNextTelemetry();
  continueSetup();
}

function continueSetup(): void {
  console.log('📄 Extracting CONVEX_URL from backend .env.local...');
  const convexUrl = getConvexUrl();
  console.log(`✅ Found CONVEX_URL: ${convexUrl}`);

  console.log('📄 Setting up webapp .env.local file...');
  setupWebappEnv(convexUrl);
  console.log('✅ Webapp .env.local file created/updated successfully.');

  // Update CLI config with webapp URL
  updateCliConfig(webappEnvPath);

  console.log('\n🎉 Setup completed successfully!');
  console.log('You can now run "pnpm run dev" to start both the frontend and backend services.');

  rl.close();
}

void setup();
