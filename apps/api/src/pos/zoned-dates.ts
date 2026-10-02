/**
 * Calendar maths in a given IANA time zone, so report periods follow the shop's clock
 * rather than the server's. Uses only Intl; correct across daylight-saving changes.
 */

type LocalDate = { year: number; month: number; day: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The wall-clock reading in `timeZone` at `instant`, as if that reading were UTC. */
function wallClockAsUtc(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/** The calendar date in `timeZone` at `instant`. */
export function localDate(instant: Date, timeZone: string): LocalDate {
  const wall = new Date(wallClockAsUtc(instant.getTime(), timeZone));
  return { year: wall.getUTCFullYear(), month: wall.getUTCMonth() + 1, day: wall.getUTCDate() };
}

/**
 * The instant local midnight starts on the given calendar date in `timeZone`. Day and
 * month overflow like Date.UTC (day 32 is the 1st of next month). Where midnight is
 * skipped by a daylight-saving jump, this is the first instant of that day.
 */
export function startOfLocalDay(year: number, month: number, day: number, timeZone: string): Date {
  const wallMidnight = Date.UTC(year, month - 1, day);
  // Offset from a first guess, then once more in case the guess fell across a DST change.
  let instant = wallMidnight - (wallClockAsUtc(wallMidnight, timeZone) - wallMidnight);
  instant = wallMidnight - (wallClockAsUtc(instant, timeZone) - instant);
  // If midnight doesn't exist that day (clocks jump from 00:00), we land on the previous
  // evening; step forward by the gap to the first instant of the day.
  const wall = wallClockAsUtc(instant, timeZone);
  if (wall < wallMidnight) instant += wallMidnight - wall;
  return new Date(instant);
}

/** [start, end) of today, this week (Monday first) and this month in `timeZone`. */
export function reportPeriods(now: Date, timeZone: string) {
  const { year, month, day } = localDate(now, timeZone);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = Sunday
  const daysSinceMonday = (weekday + 6) % 7;
  return {
    today: { start: startOfLocalDay(year, month, day, timeZone), end: startOfLocalDay(year, month, day + 1, timeZone) },
    week: {
      start: startOfLocalDay(year, month, day - daysSinceMonday, timeZone),
      end: startOfLocalDay(year, month, day - daysSinceMonday + 7, timeZone)
    },
    month: { start: startOfLocalDay(year, month, 1, timeZone), end: startOfLocalDay(year, month + 1, 1, timeZone) }
  };
}
