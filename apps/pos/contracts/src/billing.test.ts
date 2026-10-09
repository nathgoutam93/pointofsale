import { describe, expect, it } from 'vitest';
import { addBillingPeriod, billingStateAt, GRACE_DAYS } from './billing';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-03T12:00:00.000Z');
const days = (n: number) => new Date(now.getTime() + n * DAY);

describe('billingStateAt', () => {
  it('is on trial until the trial ends, then past due for the grace period, then read-only', () => {
    expect(billingStateAt({ trialEndsAt: days(3), paidUntil: null }, now).state).toBe('trial');
    expect(billingStateAt({ trialEndsAt: days(-1), paidUntil: null }, now).state).toBe('past_due');
    expect(billingStateAt({ trialEndsAt: days(-GRACE_DAYS + 0.5), paidUntil: null }, now).state).toBe('past_due');
    const ended = billingStateAt({ trialEndsAt: days(-GRACE_DAYS - 0.5), paidUntil: null }, now);
    expect(ended.state).toBe('read_only');
    expect(ended.graceEndsAt).toEqual(days(-0.5));
  });

  it('is active while paid, whichever date ends later', () => {
    const paid = billingStateAt({ trialEndsAt: days(-30), paidUntil: days(10) }, now);
    expect(paid).toEqual({ state: 'active', endsAt: days(10), graceEndsAt: days(10 + GRACE_DAYS) });
    // Paid during the trial: the paid time runs on after it.
    expect(billingStateAt({ trialEndsAt: days(5), paidUntil: days(35) }, now).endsAt).toEqual(days(35));
    expect(billingStateAt({ trialEndsAt: days(-30), paidUntil: days(-2) }, now).state).toBe('past_due');
  });

  it('is read-only with neither date', () => {
    expect(billingStateAt({ trialEndsAt: null, paidUntil: null }, now)).toEqual({ state: 'read_only', endsAt: null, graceEndsAt: null });
  });
});

describe('addBillingPeriod', () => {
  it('adds calendar months, keeping to the end of shorter months', () => {
    expect(addBillingPeriod(new Date('2026-01-15T10:00:00Z'), 'month').toISOString()).toBe('2026-02-15T10:00:00.000Z');
    expect(addBillingPeriod(new Date('2026-01-31T10:00:00Z'), 'month').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addBillingPeriod(new Date('2027-12-31T00:00:00Z'), 'month').toISOString()).toBe('2028-01-31T00:00:00.000Z');
    expect(addBillingPeriod(new Date('2028-02-29T00:00:00Z'), 'year').toISOString()).toBe('2029-02-28T00:00:00.000Z');
  });
});
