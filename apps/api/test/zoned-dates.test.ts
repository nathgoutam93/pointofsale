import { describe, expect, it } from 'vitest';
import { localDate, reportPeriods, startOfLocalDay } from '../src/pos/zoned-dates';

// #15: calendar maths in a time zone, independent of the server's clock.
const iso = (d: Date) => d.toISOString();

describe('reportPeriods', () => {
  it('works out an Indian day, week (Monday) and month in UTC instants', () => {
    const p = reportPeriods(new Date('2026-10-02T11:20:00Z'), 'Asia/Kolkata');
    expect(iso(p.today.start)).toBe('2026-10-01T18:30:00.000Z');
    expect(iso(p.today.end)).toBe('2026-10-02T18:30:00.000Z');
    expect(iso(p.week.start)).toBe('2026-09-27T18:30:00.000Z');
    expect(iso(p.month.start)).toBe('2026-09-30T18:30:00.000Z');
  });

  it('puts 01:30 IST on the Indian date even though UTC is still on the day before', () => {
    expect(localDate(new Date('2026-10-01T20:00:00Z'), 'Asia/Kolkata')).toEqual({ year: 2026, month: 10, day: 2 });
    expect(iso(reportPeriods(new Date('2026-10-31T20:00:00Z'), 'Asia/Kolkata').month.start)).toBe('2026-10-31T18:30:00.000Z');
    expect(iso(reportPeriods(new Date('2026-12-31T20:00:00Z'), 'Asia/Kolkata').week.start)).toBe('2026-12-27T18:30:00.000Z');
  });

  it('handles 25- and 23-hour days and a day whose midnight is skipped', () => {
    const fallBack = reportPeriods(new Date('2026-11-01T12:00:00Z'), 'America/New_York').today;
    expect((fallBack.end.getTime() - fallBack.start.getTime()) / 3600000).toBe(25);
    const springForward = reportPeriods(new Date('2026-03-08T12:00:00Z'), 'America/New_York').today;
    expect((springForward.end.getTime() - springForward.start.getTime()) / 3600000).toBe(23);
    expect(iso(startOfLocalDay(2018, 11, 4, 'America/Sao_Paulo'))).toBe('2018-11-04T03:00:00.000Z');
  });

  it('starts every day of 2024-2027 at that day’s first instant in unusual zones', () => {
    for (const zone of ['Asia/Kolkata', 'Australia/Lord_Howe', 'Pacific/Chatham', 'America/Santiago', 'Asia/Kathmandu']) {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
      for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2028, 0, 1); t += 86400000) {
        const d = new Date(t);
        const start = startOfLocalDay(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), zone);
        const want = d.toISOString().slice(0, 10);
        expect(fmt.format(start)).toBe(want);
        expect(fmt.format(new Date(start.getTime() - 1))).not.toBe(want);
      }
    }
  });
});
