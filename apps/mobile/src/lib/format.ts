/**
 * Formatting utilities — pure functions, no React.
 * All monetary values are integer paise (₹1 = 100 paise).
 */

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const INR_COMPACT_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/**
 * Converts integer paise to a formatted Indian rupee string.
 * e.g. formatMoney(100000) → "₹1,000"
 *      formatMoney(10000000) → "₹1,00,000"
 *
 * @param paise  Integer paise value
 * @param opts.showSign  Prefix + for positive values
 * @param opts.compact   Use compact notation (₹1.2L)
 * @param opts.abs       Always show absolute value (strip sign)
 */
export function formatMoney(
  paise: number,
  opts: { showSign?: boolean; compact?: boolean; abs?: boolean } = {},
): string {
  const rupees = paise / 100;
  const value = opts.abs ? Math.abs(rupees) : rupees;

  const formatted = opts.compact
    ? INR_COMPACT_FORMATTER.format(value)
    : INR_FORMATTER.format(value);

  if (opts.showSign && rupees > 0) {
    return `+${formatted}`;
  }
  return formatted;
}

/**
 * Converts a rupee float/integer to paise (integer).
 * Always use this when accepting user input.
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

/**
 * Formats an ISO date string (YYYY-MM-DD) to a human-friendly label.
 * e.g. "2025-10-22" → "Today", "Yesterday", or "22 Oct"
 */
export function formatDate(isoDate: string, today: Date = new Date()): string {
  const todayStr = toISODate(today);
  const yesterdayStr = toISODate(new Date(today.getTime() - 86_400_000));

  if (isoDate === todayStr) return 'Today';
  if (isoDate === yesterdayStr) return 'Yesterday';

  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const sameYear = date.getFullYear() === today.getFullYear();

  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
}

/** Formats HH:MM time string to 12-hour format, e.g. "3:42 PM" */
export function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/** Returns a combined label: "Today, 3:42 PM" */
export function formatDateTime(isoDate: string, time: string, today?: Date): string {
  return `${formatDate(isoDate, today)}, ${formatTime(time)}`;
}

/** Returns today's date as YYYY-MM-DD in local time */
export function toISODate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Returns local time as HH:MM */
export function toHHMM(date: Date = new Date()): string {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Returns YYYY-MM for a given date */
export function toYYYYMM(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Parses a YYYY-MM-DD string into a Date at midnight local time */
export function parseISODate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Formats a percentage, e.g. 0.832 → "83%" */
export function formatPercent(ratio: number, decimals = 0): string {
  return `${(ratio * 100).toFixed(decimals)}%`;
}
