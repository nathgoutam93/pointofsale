import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from './version';

describe('APP_VERSION', () => {
  it('matches the root package.json version', () => {
    const root = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(APP_VERSION).toBe(root.version);
  });

  it('matches the desktop app version, which installers and updates are named by', () => {
    const desktop = JSON.parse(readFileSync(new URL('../../../apps/desktop/package.json', import.meta.url), 'utf8'));
    expect(APP_VERSION).toBe(desktop.version);
  });
});
