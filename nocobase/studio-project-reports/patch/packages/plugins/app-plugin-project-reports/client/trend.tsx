import { useId, useState, type ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { addDays } from '../shared/dates.js';
import { totals, type ReportView } from '../shared/api.js';

export type Metric = 'code' | 'tests' | 'tasks';
interface Point { date: string; first: number | null; second: number | null; estimated: boolean }
export function trendPoints(reports: readonly ReportView[], day: string, days: number, metric: Metric): Point[] {
  const byDay = new Map(reports.map((report) => [report.date, report]));
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(day, index + 1 - days);
    const report = byDay.get(date);
    const figures = totals(report?.facts ?? null);
    if (metric === 'tasks') return { date, first: report?.material.issues.created ?? null, second: report?.material.issues.completed ?? null, estimated: false };
    const delta = figures[metric];
    return { date, first: delta?.added ?? null, second: delta?.deleted ?? null, estimated: metric === 'tests' && figures.estimatedTests };
  });
}

/** Split paths at unknown values and at a change in test-counting method. */
export function paths(points: readonly Point[], key: 'first' | 'second', maximum: number): string[] {
  const result: string[] = [];
  let active = '';
  let previousMethod: boolean | undefined;
  points.forEach((point, index) => {
    const value = point[key];
    if (value === null || previousMethod !== undefined && previousMethod !== point.estimated) {
      if (active) result.push(active);
      active = '';
    }
    if (value !== null) active += `${active ? ' L' : 'M'}${40 + index / Math.max(1, points.length - 1) * 720} ${190 - value / maximum * 150}`;
    previousMethod = point.estimated;
  });
  if (active) result.push(active);
  return result;
}

export function Trend({ reports, date, days }: { reports: readonly ReportView[]; date: string; days: number }): ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const [metric, setMetric] = useState<Metric>('code');
  const points = trendPoints(reports, date, days, metric);
  const maximum = Math.max(1, ...points.flatMap((point) => [point.first ?? 0, point.second ?? 0]));
  const first = t(metric === 'tasks' ? 'created' : 'added');
  const second = t(metric === 'tasks' ? 'completed' : 'deleted');
  const any = points.some((point) => point.first !== null || point.second !== null);
  return <section className='rounded-xl border bg-card p-5' aria-labelledby={id}>
    <div className='flex flex-wrap items-center justify-between gap-3'>
      <h2 id={id} className='text-base font-semibold'>{t('trend')}</h2>
      <div className='flex gap-2' role='group' aria-label={t('metric')}>
        {(['code', 'tests', 'tasks'] as const).map((key) => <button key={key} type='button' aria-pressed={key === metric} onClick={() => setMetric(key)} className={`rounded-md px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-ring ${key === metric ? 'bg-secondary font-medium' : 'text-muted-foreground hover:bg-muted'}`}>{t(key)}</button>)}
      </div>
    </div>
    <p className='mt-2 text-xs leading-5 text-muted-foreground'>{t(metric === 'tests' ? 'testHint' : metric === 'code' ? 'sourceScope' : 'trendHint')}</p>
    {any ? <>
      <div className='mt-4 flex gap-5 text-xs' aria-hidden='true'><span style={{ color: 'var(--chart-1)' }}>━ {first}</span><span style={{ color: 'var(--chart-2)' }}>┄ {second}</span></div>
      <svg viewBox='0 0 800 230' role='img' aria-label={`${t(metric)} — ${points[0]?.date ?? ''} / ${date}`} className='mt-1 block w-full'>
        <title>{t(metric)}</title>
        <line x1='40' y1='190' x2='760' y2='190' stroke='var(--border)' />
        <line x1='40' y1='40' x2='760' y2='40' stroke='var(--border)' strokeDasharray='4 4' />
        <text x='32' y='44' textAnchor='end' fontSize='11' fill='var(--muted-foreground)'>{maximum.toLocaleString()}</text>
        <text x='32' y='194' textAnchor='end' fontSize='11' fill='var(--muted-foreground)'>0</text>
        {(['first', 'second'] as const).flatMap((key) => paths(points, key, maximum).map((value) => <path key={`${key}:${value}`} d={value} fill='none' stroke={`var(--chart-${key === 'first' ? 1 : 2})`} strokeWidth='2.5' strokeDasharray={key === 'second' ? '5 4' : undefined} />))}
        {points.flatMap((point, index) => (['first', 'second'] as const).map((key) => point[key] === null ? null : <circle key={`${point.date}:${key}`} cx={40 + index / Math.max(1, points.length - 1) * 720} cy={190 - (point[key] ?? 0) / maximum * 150} r='3' fill={`var(--chart-${key === 'first' ? 1 : 2})`}><title>{point.date}: {key === 'first' ? first : second} {point[key]}{point.estimated ? ` (${t('estimated')})` : ''}</title></circle>))}
        <text x='40' y='218' fontSize='11' fill='var(--muted-foreground)'>{points[0]?.date}</text><text x='760' y='218' textAnchor='end' fontSize='11' fill='var(--muted-foreground)'>{date}</text>
      </svg>
    </> : <p className='py-12 text-center text-sm text-muted-foreground'>{t('noTrend')}</p>}
    <details className='mt-3 text-sm'><summary className='cursor-pointer text-muted-foreground'>{t('trendTable')}</summary>
      <div className='mt-3 max-h-72 overflow-auto'><table className='w-full text-left text-xs'><caption className='sr-only'>{t('trend')}</caption><thead><tr><th className='py-2'>{t('date')}</th><th>{first}</th><th>{second}</th></tr></thead><tbody>
        {points.map((point) => <tr key={point.date} className='border-t'><td className='py-2'>{point.date}{point.estimated ? ` · ${t('estimated')}` : ''}</td><td>{point.first ?? '—'}</td><td>{point.second ?? '—'}</td></tr>)}
      </tbody></table></div>
    </details>
  </section>;
}
