const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getTokyoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function dateOrdinal(value) {
  if (!DATE_PATTERN.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return Math.floor(date.getTime() / DAY_MS);
}

export function isoDateFromOrdinal(ordinal) {
  return new Date(ordinal * DAY_MS).toISOString().slice(0, 10);
}

export function recentTokyoDates(today, days) {
  const ordinal = dateOrdinal(today);
  if (ordinal === null || !Number.isSafeInteger(days) || days < 1 || days > 31) {
    throw new TypeError("invalid history range");
  }
  return Array.from({ length: days }, (_, index) =>
    isoDateFromOrdinal(ordinal - days + 1 + index)
  );
}

export function tokyoDateRangeMs(firstDate, lastDate = firstDate) {
  const firstOrdinal = dateOrdinal(firstDate);
  const lastOrdinal = dateOrdinal(lastDate);
  if (
    firstOrdinal === null ||
    lastOrdinal === null ||
    lastOrdinal < firstOrdinal
  ) {
    throw new TypeError("invalid Tokyo date range");
  }
  return {
    startMs: firstOrdinal * DAY_MS - TOKYO_OFFSET_MS,
    endMs: (lastOrdinal + 1) * DAY_MS - TOKYO_OFFSET_MS,
  };
}
