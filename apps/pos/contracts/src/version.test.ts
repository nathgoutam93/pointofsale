import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, isOlderVersion } from './version';

describe('APP_VERSION', () => {
  it('matches the desktop app version, which installers and updates are named by', () => {
    const desktop = JSON.parse(readFileSync(new URL('../../desktop/package.json', import.meta.url), 'utf8'));
    expect(APP_VERSION).toBe(desktop.version);
  });
});

describe('isOlderVersion', () => {
  it('compares versions number by number, not as text', () => {
    expect(isOlderVersion('0.9.0', '0.10.0')).toBe(true);
    expect(isOlderVersion('1.2.3', '1.2.3')).toBe(false);
    expect(isOlderVersion('1.2.4', '1.2.3')).toBe(false);
    expect(isOlderVersion('1.2', '1.2.1')).toBe(true);
    expect(isOlderVersion('2.0.0', '1.99.99')).toBe(false);
  });
});
