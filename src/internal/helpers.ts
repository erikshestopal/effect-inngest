/**
 * Internal helper utilities.
 * @internal
 */
import * as Duration from "effect/Duration";

const millisecond = 1;
const second = millisecond * 1000;
const minute = second * 60;
const hour = minute * 60;
const day = hour * 24;
const week = day * 7;

const periods = [
  ["w", week],
  ["d", day],
  ["h", hour],
  ["m", minute],
  ["s", second],
] as const;

/**
 * Convert a Duration to an Inngest-compatible time string (e.g. `"1d"` or `"2h30m"`).
 *
 * Supports weeks, days, hours, minutes, and seconds. Years/months are converted
 * to their equivalent in weeks/days.
 */
export const timeStr = (input: Duration.Input): string => {
  let ms = Duration.toMillis(Duration.fromInputUnsafe(input));

  const [, result] = periods.reduce<[number, string]>(
    ([num, str], [suffix, period]) => {
      const numPeriods = Math.floor(num / period);

      if (numPeriods > 0) {
        return [num % period, `${str}${numPeriods}${suffix}`];
      }

      return [num, str];
    },
    [ms, ""],
  );

  return result || "0s";
};

/**
 * Format a timestamp as an ISO string for Inngest's sleepUntil.
 */
export const formatTimestamp = (timestamp: Date | number | string): string => {
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  if (typeof timestamp === "number") {
    return new Date(timestamp).toISOString();
  }
  return timestamp;
};
