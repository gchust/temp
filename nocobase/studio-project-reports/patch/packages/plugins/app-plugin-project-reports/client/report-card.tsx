import { useId, type ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { totals, type ReportView, type Summary } from '../shared/api.js';
import { Button } from './components/ui/button.js';

export const importance = (item: Summary['items'][number]): number => ({ risk: 0, 'critical-fix': 1, feature: 2, architecture: 3, fix: 4, maintenance: 5 })[item.category];
export function Metric({ label, added, deleted, hint }: { label: string; added: number | null; deleted: number | null; hint?: string }): ReactElement {
  const { t } = useTranslation();
  return <div className='min-w-0'><dt className='text-xs text-muted-foreground'>{label}</dt><dd className='mt-1 text-base font-semibold tabular-nums'>{added === null || deleted === null ? <span className='text-sm font-normal text-muted-foreground'>{t('unavailable')}</span> : <><span>+{added.toLocaleString()}</span><span className='ml-2 text-muted-foreground'>−{deleted.toLocaleString()}</span></>}</dd>{hint ? <p className='mt-1 text-xs text-muted-foreground'>{hint}</p> : null}</div>;
}
export function ReportCard({ report, canManage, pending, onGenerate, onCancel }: { report: ReportView; canManage: boolean; pending: boolean; onGenerate: () => void; onCancel: () => void }): ReactElement {
  const { t } = useTranslation();
  const id = useId();
  const figures = totals(report.facts);
  const retained = report.publishedAttemptId !== null && report.publishedAttemptId !== report.currentAttemptId;
  const items = [...report.summary?.items ?? []].sort((left, right) => importance(left) - importance(right));
  const evidenceTitle = (key: string): string => {
    if (key.startsWith('issue:')) { const issue = report.material.issues.items.find((item) => `issue:${item.id}` === key); return issue ? `${issue.identifier} ${issue.title}` : key; }
    const commit = report.facts?.repositories.flatMap((repository) => repository.commits.map((entry) => ({ key: `git:${repository.resourceId}:${entry.sha}`, ...entry }))).find((entry) => entry.key === key);
    return commit ? `${commit.sha.slice(0, 8)} ${commit.title}` : key;
  };
  return <article className='rounded-xl border bg-card p-5 sm:p-6' aria-labelledby={id}>
    <div className='flex flex-wrap items-start justify-between gap-3'>
      <div><h2 id={id} className='text-lg font-semibold tracking-tight'>{report.projectName}</h2><p className='mt-1 text-xs text-muted-foreground'>{report.date} · {report.timezone}</p></div>
      <div className='flex items-center gap-2'><span className={`rounded-md px-2 py-1 text-xs ${report.status === 'failed' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{t(`status.${report.status}`)}</span>
        {canManage ? <Button size='sm' variant='ghost' disabled={pending} onClick={report.status === 'generating' ? onCancel : onGenerate}>{t(report.status === 'generating' ? 'cancel' : 'regenerate')}</Button> : null}
      </div>
    </div>
    {retained ? <p role='status' className='mt-3 rounded-md bg-muted p-3 text-xs'>{t('retained')}</p> : null}
    {report.status === 'failed' ? <p role='alert' className='mt-3 text-sm text-destructive'>{t('failedMessage')}</p> : null}
    <p className='mt-4 text-sm leading-7'>{report.summary?.overview ?? t('waitingSummary')}</p>
    {items.length ? <div className='mt-5 space-y-5'>{items.map((item, index) => <section key={`${item.category}:${index}`} className={item.category === 'risk' || item.category === 'critical-fix' ? 'rounded-lg border border-border bg-muted/40 p-4' : ''}>
      <div className='mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs'><span className={item.category === 'risk' ? 'font-medium text-destructive' : 'font-medium text-muted-foreground'}>{t(`category.${item.category}`)}</span><span className='text-muted-foreground'>{t(`stage.${item.stage}`)}</span></div>
      <h3 className='text-sm font-semibold'>{item.title}</h3><p className='mt-1 text-sm leading-6 text-muted-foreground'>{item.description}</p>
      <details className='mt-2 text-xs'><summary className='cursor-pointer text-muted-foreground'>{t('evidence')} · {item.evidence.length}</summary><div className='mt-2 space-y-1.5'>{item.evidence.map((key) => <p key={key} className='break-words'>{key.startsWith('issue:') ? <Link className='underline underline-offset-2' to={`/issues/${encodeURIComponent(key.slice(6))}`}>{evidenceTitle(key)}</Link> : evidenceTitle(key)}</p>)}</div></details>
    </section>)}</div> : null}
    {report.summary?.minorFixes ? <p className='mt-5 text-sm leading-6 text-muted-foreground'><span className='font-medium'>{t('otherFixes')}：</span>{report.summary.minorFixes}</p> : null}
    <dl className='mt-6 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4'>
      <Metric label={t('code')} added={figures.code?.added ?? null} deleted={figures.code?.deleted ?? null} />
      <Metric label={t('tests')} added={figures.tests?.added ?? null} deleted={figures.tests?.deleted ?? null} hint={figures.tests ? t(figures.estimatedTests ? 'estimated' : 'precise') : undefined} />
      <div><dt className='text-xs text-muted-foreground'>{t('created')} / {t('completed')}</dt><dd className='mt-1 text-base font-semibold tabular-nums'>{report.material.issues.created} / {report.material.issues.completed}</dd></div>
      <div><dt className='text-xs text-muted-foreground'>{t('cancelled')} / {t('reopened')}</dt><dd className='mt-1 text-base font-semibold tabular-nums'>{report.material.issues.cancelled} / {report.material.issues.reopened}</dd></div>
    </dl>
    <details className='mt-5 border-t pt-4 text-xs'><summary className='cursor-pointer text-muted-foreground'>{t('evidence')} · {t('window')} · {t('range')}</summary>
      <div className='mt-3 space-y-4 text-muted-foreground'><p>{t('window')}: {report.material.from} — {report.material.to}</p><p>{t('generated')}: {report.generatedAt ?? '—'}</p><p>{t('sourceScope')}</p>
        {report.facts?.repositories.map((repository) => {
          const spec = report.material.repositories.find((entry) => entry.resourceId === repository.resourceId);
          return <div key={repository.resourceId} className='rounded-lg border p-3'>
            <p className='break-all font-medium text-foreground'>{spec?.url}</p><p className='mt-1'>{t('ref')}: {spec?.ref ?? t('defaultRef')} · {t('commits')}: {repository.commitCount}</p>
            {repository.status === 'failed' ? <p className='mt-2 text-destructive'>{t('collecting')}</p> : <>
              <p className='mt-1 break-all font-mono'>{repository.baseSha?.slice(0, 12) ?? '∅'} → {repository.headSha?.slice(0, 12) ?? '∅'}</p>
              <p className='mt-2'>{t('boundaryEstimate')}</p>
              {repository.code ? <div className='mt-2 grid gap-1 sm:grid-cols-2'>{([['tests', 'testLines'], ['documentation', 'documentation'], ['configuration', 'configuration'], ['generated', 'generatedFiles']] as const).map(([key, label]) => <p key={key}>{t(label)}: +{repository.code?.[key].added} / −{repository.code?.[key].deleted}</p>)}</div> : null}
              {repository.truncated ? <p className='mt-2'>{t('truncation')}</p> : null}
            </>}
          </div>;
        })}
      </div>
    </details>
  </article>;
}
