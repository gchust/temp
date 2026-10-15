import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation, withNamespace } from '@nocobase/i18n/client';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { PACKAGE, type ReportView } from '../shared/api.js';
import { addDays, dayAt, isDay } from '../shared/dates.js';
import { useReportsApi, reportKeys } from './api.js';
import { PageContainer } from './components/page-container.js';
import { PageHeader } from './components/page-header.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';
import { ReportSettings, selectClass } from './settings.js';
import { ReportCard } from './report-card.js';
import { Trend } from './trend.js';

function ReportsContent(): ReactElement {
  const { t } = useTranslation();
  const api = useReportsApi();
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const projectId = params.get('project') ?? '';
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = isDay(params.get('date') ?? '') ? params.get('date')! : addDays(dayAt(new Date(), browserZone), -1);
  const days = params.get('days') === '30' ? 30 : 7;
  const options = useQuery({ queryKey: [...reportKeys, 'options'], queryFn: () => api.options(), staleTime: 30_000 });
  const reports = useQuery({
    queryKey: [...reportKeys, 'list', date, days, projectId], queryFn: () => api.list(date, projectId ? days : 1, projectId || undefined),
    refetchInterval: (query) => query.state.data?.reports.some((report) => report.status === 'generating') ? 5_000 : false,
    refetchOnWindowFocus: true,
  });
  const change = (key: string, value: string): void => { setParams((current) => { const next = new URLSearchParams(current); if (value) next.set(key, value); else next.delete(key); return next; }); };
  const refresh = (): Promise<void> => cache.invalidateQueries({ queryKey: reportKeys });
  const generate = useMutation({ mutationFn: ({ id, current }: { id: string; current?: ReportView }) => api.generate(id, date, current), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (id: string) => api.cancel(id), onSuccess: refresh });
  const todays = reports.data?.reports.filter((report) => report.date === date) ?? [];
  const selected = options.data?.projects.find((project) => project.id === projectId);
  const current = todays.find((report) => report.projectId === projectId);
  const busy = generate.isPending || cancel.isPending;
  const generateOne = (id: string, existing?: ReportView): void => {
    if (existing && !window.confirm(t('confirmRegenerate'))) return;
    generate.mutate({ id, current: existing });
  };
  const cancelOne = (id: string): void => { if (window.confirm(t('confirmCancel'))) cancel.mutate(id); };
  const notices = todays.flatMap((report) => report.summary?.items.filter((item) => item.category === 'risk' || item.category === 'critical-fix').map((item) => ({ report, item })) ?? []).slice(0, 5);
  const ready = todays.filter((report) => report.summary !== null).length;
  return <PageContainer className='space-y-6'>
    <PageHeader title={t('title')} description={t('description')} actions={<Button variant='outline' onClick={() => void refresh()} disabled={reports.isFetching}><RefreshCw className={`size-4 ${reports.isFetching ? 'animate-spin' : ''}`} aria-hidden='true' />{t('refresh')}</Button>} />
    <div className='grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-3'>
      <label className='space-y-1.5 text-sm'>{t('project')}<select className={selectClass} value={projectId} onChange={(event) => change('project', event.target.value)}><option value=''>{t('allProjects')}</option>{options.data?.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label className='space-y-1.5 text-sm'>{t('date')}<Input type='date' value={date} onChange={(event) => { if (isDay(event.target.value)) change('date', event.target.value); }} /></label>
      <label className='space-y-1.5 text-sm'>{t('period')}<select className={selectClass} value={days} disabled={!projectId} onChange={(event) => change('days', event.target.value)}><option value='7'>{t('days', { count: 7 })}</option><option value='30'>{t('days', { count: 30 })}</option></select></label>
    </div>
    {selected?.canManage ? <div className='space-y-3'><ReportSettings key={projectId} projectId={projectId} agents={options.data?.agents ?? []} /><div className='flex flex-wrap items-center gap-3'><Button disabled={busy || current?.status === 'generating'} onClick={() => generateOne(projectId, current)}>{t(current ? 'regenerate' : 'generate')}</Button><span className='text-xs text-muted-foreground'>{t('completeDay')}</span></div></div> : null}
    {generate.isError || cancel.isError ? <p role='alert' className='rounded-lg border border-destructive/30 p-4 text-sm text-destructive'>{t('mutationError')}</p> : null}
    {options.isError || reports.isError ? <div role='alert' className='rounded-xl border p-6'><p className='text-sm text-destructive'>{t('error')}</p><Button className='mt-3' variant='outline' onClick={() => void refresh()}>{t('refresh')}</Button></div> : options.isPending || reports.isPending ? <p role='status' className='py-16 text-center text-sm text-muted-foreground'>{t('loading')}</p> : <>
      {!options.data.projects.length ? <section className='rounded-xl border p-12 text-center'><h2 className='font-semibold'>{t('noProjects')}</h2><p className='mt-2 text-sm text-muted-foreground'>{t('noProjectsDescription')}</p></section> : <>
        {todays.length ? <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>{[
          ['projectsReported', todays.length], ['available', ready], ['pending', todays.filter((report) => report.status === 'generating').length], ['incomplete', todays.filter((report) => report.status === 'partial' || report.status === 'failed').length],
        ].map(([label, value]) => <div key={String(label)} className='rounded-xl border bg-card px-4 py-3'><p className='text-xs text-muted-foreground'>{t(String(label))}</p><p className='mt-1 text-2xl font-semibold tabular-nums'>{value}</p></div>)}</div> : null}
        {notices.length && !projectId ? <section className='rounded-xl border bg-muted/30 p-5'><h2 className='text-sm font-semibold'>{t('attention')}</h2><div className='mt-3 space-y-3'>{notices.map(({ report, item }, index) => <p key={`${report.id}:${index}`} className='text-sm leading-6'><button type='button' className='mr-2 font-medium underline underline-offset-2' onClick={() => change('project', report.projectId)}>{report.projectName}</button><span className={item.category === 'risk' ? 'text-destructive' : ''}>{item.title}</span><span className='ml-2 text-xs text-muted-foreground'>{t(`stage.${item.stage}`)}</span></p>)}</div></section> : null}
        {todays.length ? <div className='space-y-5'>{todays.map((report) => <ReportCard key={report.id} report={report} canManage={options.data.projects.some((project) => project.id === report.projectId && project.canManage)} pending={busy} onGenerate={() => generateOne(report.projectId, report)} onCancel={() => cancelOne(report.id)} />)}</div> : <section className='rounded-xl border p-12 text-center'><h2 className='font-semibold'>{t('empty')}</h2><p className='mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground'>{t('emptyDescription')}</p></section>}
        {projectId ? <Trend reports={reports.data?.reports ?? []} date={date} days={days} /> : <p className='text-sm text-muted-foreground'>{t('trendHint')}</p>}
        {reports.data?.truncated ? <p role='status' className='text-sm text-muted-foreground'>{t('reportTruncated')}</p> : null}
      </>}
    </>}
    <p className='text-xs text-muted-foreground'>{t('codeNotProductivity')}</p>
  </PageContainer>;
}
const BoundReports = withNamespace(PACKAGE, ReportsContent);
export default function ReportsPage(): ReactElement {
  // Scope cache to this page mount, not a module-global singleton shared between signed-in users.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000 } } }));
  return <QueryClientProvider client={client}><BoundReports /></QueryClientProvider>;
}
