import { describe, expect, it } from 'vitest';
import { setupRoutes } from './contract/auth.js';

const details = { businessName: 'Shop', branchCode: 'SHP', adminUsername: 'admin', adminPassword: 'test-password-1' };
describe('setup registration', () => {
  it('defaults a shop without GSTIN to unregistered, and retains registered setup for older clients supplying a GSTIN', () => {
    expect(setupRoutes.run.body.parse(details).taxpayerType).toBe('UNREGISTERED');
    expect(setupRoutes.run.body.parse({ ...details, gstNumber: '29ABCDE1234F1ZW' }).taxpayerType).toBe('REGULAR');
  });
  it('rejects incompatible GSTIN and registration choices', () => {
    expect(setupRoutes.run.body.safeParse({ ...details, taxpayerType: 'REGULAR' }).success).toBe(false);
    expect(setupRoutes.run.body.safeParse({ ...details, taxpayerType: 'UNREGISTERED', gstNumber: '29ABCDE1234F1ZW' }).success).toBe(false);
    expect(setupRoutes.run.body.safeParse({ ...details, taxpayerType: 'COMPOSITION', gstNumber: '29ABCDE1234F1ZW', compositionCategory: 'TRADER' }).success).toBe(true);
  });
});
