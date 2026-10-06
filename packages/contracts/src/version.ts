/**
 * The version of the whole product: desktop app, API and web app ship together under it.
 * Change it together with "version" in the root and apps/desktop package.json files (a test
 * checks they match).
 */
export const APP_VERSION = '0.1.6';

/** Request header the desktop app sends with its version, so the server can turn away old apps. */
export const CLIENT_VERSION_HEADER = 'x-pos-client-version';

/** HTTP status the server answers an app older than its minimum with (426 Upgrade Required). */
export const UPDATE_REQUIRED_STATUS = 426;

/** True when `version` (x.y.z) is older than `minimum`, compared number by number. */
export function isOlderVersion(version: string, minimum: string) {
  const a = version.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const b = minimum.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length, 3); i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}
