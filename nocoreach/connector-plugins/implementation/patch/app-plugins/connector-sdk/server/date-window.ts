import { systemMessageText } from '../shared/i18n/messages.js';

const DAY = 86_400_000;
const iso = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);
const add = (date: string, count: number): string => iso(Date.parse(date + 'T00:00:00Z') + count * DAY);
const days = (start: string, end: string): number => Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
const ranges = ['7', '28', '90', '3m', '6m', '12m', '16m'];
const invalid = (key: string): never => { throw Object.assign(new Error(systemMessageText(key)), { status: 400 }); };
function calendarDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && iso(Date.parse(value + 'T00:00:00Z')) === value;
}

export interface DateWindow {
  start: string;
  end: string;
  days: number;
  previousStart: string;
  previousEnd: string;
}

/** Shared historical window semantics; an adapter must not invent a different comparison period. */
export function windowFor(end: string, range: string, from?: unknown, to?: unknown): DateWindow {
  if (range === 'custom') {
    if (!calendarDate(from) || !calendarDate(to) || from > to) return invalid('dataViews.pickValidStartEndDates');
    const count = days(from, to);
    if (count > 490) return invalid('dataViews.customRangesUp16Months');
    return { start: from, end: to < end ? to : end, days: count, previousStart: add(from, -count), previousEnd: add(from, -1) };
  }
  if (!ranges.includes(String(range))) return invalid('dataViews.unsupportedDateRange');
  let start: string;
  if (range.endsWith('m')) {
    const cursor = new Date(Date.parse(end + 'T00:00:00Z') + DAY);
    const day = cursor.getUTCDate();
    cursor.setUTCDate(1);
    cursor.setUTCMonth(cursor.getUTCMonth() - Number.parseInt(range, 10));
    cursor.setUTCDate(Math.min(day, new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate()));
    start = iso(cursor.getTime());
  } else {
    start = add(end, 1 - Number(range));
  }
  const count = days(start, end);
  return { start, end, days: count, previousStart: add(start, -count), previousEnd: add(start, -1) };
}
