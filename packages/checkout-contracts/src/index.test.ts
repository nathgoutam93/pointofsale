import { describe, expect, it } from 'vitest';
import {
  checkoutNotificationSchema,
  createSessionRequestSchema,
  signNotification,
  SIGNATURE_TOLERANCE_SECONDS,
  verifyNotification
} from './index';

const secret = 'notify-secret-for-tests';
const body = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded' });

describe('notification signatures', () => {
  it('verifies what was signed', () => {
    const now = 1_800_000_000;
    expect(verifyNotification(secret, body, signNotification(secret, body, now), now)).toBe(true);
    expect(verifyNotification(secret, Buffer.from(body), signNotification(secret, body, now), now)).toBe(true);
  });

  it('refuses a changed body, another secret, or a bad header', () => {
    const now = 1_800_000_000;
    const header = signNotification(secret, body, now);
    expect(verifyNotification(secret, body.replace('evt_1', 'evt_2'), header, now)).toBe(false);
    expect(verifyNotification('another-secret', body, header, now)).toBe(false);
    expect(verifyNotification('', body, header, now)).toBe(false);
    expect(verifyNotification(secret, body, undefined, now)).toBe(false);
    expect(verifyNotification(secret, body, 'v1=abc', now)).toBe(false);
    expect(verifyNotification(secret, body, header.replace(/v1=../, 'v1=00'), now)).toBe(false);
  });

  it('refuses a signature too old or too far ahead, so a copied notice cannot be replayed', () => {
    const signedAt = 1_800_000_000;
    const header = signNotification(secret, body, signedAt);
    expect(verifyNotification(secret, body, header, signedAt + SIGNATURE_TOLERANCE_SECONDS)).toBe(true);
    expect(verifyNotification(secret, body, header, signedAt + SIGNATURE_TOLERANCE_SECONDS + 1)).toBe(false);
    expect(verifyNotification(secret, body, header, signedAt - SIGNATURE_TOLERANCE_SECONDS - 1)).toBe(false);
  });

  it('binds the timestamp into the signature', () => {
    const header = signNotification(secret, body, 1_800_000_000);
    const moved = header.replace('t=1800000000', 't=1800000100');
    expect(verifyNotification(secret, body, moved, 1_800_000_100)).toBe(false);
  });
});

describe('createSessionRequestSchema', () => {
  it('fills in the optional parts', () => {
    const request = createSessionRequestSchema.parse({
      reference: 'chk_1',
      amount: 117882,
      currency: 'INR',
      description: 'Growth plan, 1 month',
      customer: { email: 'owner@example.com' }
    });
    expect(request).toMatchObject({ customer: { email: 'owner@example.com', name: null }, returnUrl: null, metadata: {} });
  });

  it('refuses amounts that are not whole paise, and other currencies', () => {
    const base = { reference: 'r', currency: 'INR', description: 'd', customer: { email: null } };
    expect(createSessionRequestSchema.safeParse({ ...base, amount: 10.5 }).success).toBe(false);
    expect(createSessionRequestSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
    expect(createSessionRequestSchema.safeParse({ ...base, amount: 100, currency: 'USD' }).success).toBe(false);
  });
});

describe('checkoutNotificationSchema', () => {
  it('reads a notification', () => {
    const notice = {
      id: 'evt_1',
      type: 'payment.failed',
      sessionId: 'ses_1',
      product: 'pos',
      reference: 'chk_1',
      amount: 100,
      currency: 'INR',
      reason: 'Card declined',
      metadata: {},
      occurredAt: new Date(0).toISOString()
    };
    expect(checkoutNotificationSchema.parse(notice)).toEqual(notice);
    expect(checkoutNotificationSchema.safeParse({ ...notice, type: 'refund' }).success).toBe(false);
  });
});
