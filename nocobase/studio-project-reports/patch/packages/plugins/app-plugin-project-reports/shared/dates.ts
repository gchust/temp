/** Calendar-day windows are half-open and follow the report's timezone, including DST. */
export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && value >= '1970-01-01' && value <= '9998-12-31' &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return value.length <= 100;
  } catch { return false; }
}

export function dayAt(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const part = (name: string): string => parts.find((item) => item.type === name)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDays(day: string, amount: number): string {
  if (!isDay(day) || !Number.isInteger(amount)) throw new Error('Invalid calendar day.');
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

/** First second belonging to this date. A skipped civil date is rejected rather than silently shifted. */
function midnight(day: string, timezone: string): number {
  const center = Date.parse(`${day}T00:00:00Z`) / 1000;
  let low = center - 36 * 3600;
  let high = center + 36 * 3600;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dayAt(new Date(middle * 1000), timezone) < day) low = middle + 1;
    else high = middle;
  }
  if (dayAt(new Date(low * 1000), timezone) !== day) throw new Error('This civil date does not exist in the timezone.');
  return low * 1000;
}

export function dayWindow(day: string, timezone: string): { from: string; to: string } {
  if (!isDay(day) || !isTimezone(timezone)) throw new Error('Invalid report date or timezone.');
  return { from: new Date(midnight(day, timezone)).toISOString(), to: new Date(midnight(addDays(day, 1), timezone)).toISOString() };
}

export function localHour(at: Date, timezone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(at));
}
