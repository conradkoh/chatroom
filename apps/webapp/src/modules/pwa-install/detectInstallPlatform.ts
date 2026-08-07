import type { InstallPlatform } from './types';

export interface DetectInstallPlatformInput {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  isStandalone: boolean;
}

function isIOSDevice(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

function isIOSSafari(userAgent: string): boolean {
  return /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

function iosPlatform(userAgent: string): InstallPlatform {
  return isIOSSafari(userAgent) ? 'ios-safari' : 'ios-other';
}

function isAndroidDevice(userAgent: string): boolean {
  return /Android/.test(userAgent);
}

function isAndroidChrome(userAgent: string): boolean {
  return /Chrome/.test(userAgent) && !/EdgA|OPR/.test(userAgent);
}

function androidPlatform(userAgent: string): InstallPlatform {
  return isAndroidChrome(userAgent) ? 'android-chrome' : 'android-other';
}

function isDesktopEdge(userAgent: string): boolean {
  return /Edg\//.test(userAgent);
}

function isDesktopChrome(userAgent: string): boolean {
  return /Chrome/.test(userAgent) && !/Edg/.test(userAgent);
}

function isDesktopSafari(userAgent: string): boolean {
  return /Safari/.test(userAgent) && !/Chrome/.test(userAgent);
}

function desktopPlatform(userAgent: string): InstallPlatform {
  if (isDesktopEdge(userAgent)) return 'desktop-edge';
  if (isDesktopChrome(userAgent)) return 'desktop-chrome';
  if (isDesktopSafari(userAgent)) return 'desktop-safari';
  return 'desktop-other';
}

export function detectInstallPlatform(input: DetectInstallPlatformInput): InstallPlatform {
  if (input.isStandalone) return 'already-installed';

  const { userAgent, platform, maxTouchPoints } = input;

  if (isIOSDevice(userAgent, platform, maxTouchPoints)) {
    return iosPlatform(userAgent);
  }

  if (isAndroidDevice(userAgent)) {
    return androidPlatform(userAgent);
  }

  return desktopPlatform(userAgent);
}
