function parseSemver(version: string): [number, number, number] {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Invalid semver: ${version}`);
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns negative when `a` is older, positive when `a` is newer, zero when equal. */
export function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseSemver(a);
  const [bMajor, bMinor, bPatch] = parseSemver(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

export function isRemoteVersionNewer(localVersion: string, remoteVersion: string): boolean {
  return compareSemver(localVersion, remoteVersion) < 0;
}
