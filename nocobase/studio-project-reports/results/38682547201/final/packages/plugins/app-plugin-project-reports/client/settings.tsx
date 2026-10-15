import { useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isTimezone } from '../shared/dates.js';
import type {
  AgentOption,
  Settings as SettingsValue,
  SettingsInput,
} from '../shared/api.js';
import { useReportsApi, reportKeys } from './api.js';
import { Button } from './components/ui/button.js';
import { Input } from './components/ui/input.js';

export const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50';

function SettingsForm({
  projectId,
  initial,
  agents,
}: {
  projectId: string;
  initial: SettingsValue;
  agents: readonly AgentOption[];
}): ReactElement {
  const { t } = useTranslation();
  const api = useReportsApi();
  const cache = useQueryClient();
  const [value, setValue] = useState<SettingsInput>({
    enabled: initial.enabled,
    agentId: initial.agentId,
    timezone: initial.timezone,
    hour: initial.hour,
    locale: initial.locale,
    expectedRevision: initial.revision,
  });
  const save = useMutation({
    mutationFn: () => api.save(projectId, value),
    onSuccess: async (saved) => {
      setValue((current) => ({ ...current, expectedRevision: saved.revision }));
      await cache.invalidateQueries({ queryKey: reportKeys });
    },
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className='space-y-4'>
      <p className='text-sm leading-6 text-muted-foreground'>
        {t('settingsHint')}
      </p>
      <label className='flex items-center gap-2 text-sm'>
        <input
          type='checkbox'
          checked={value.enabled}
          onChange={(event) =>
            setValue({ ...value, enabled: event.target.checked })
          }
        />
        {t('scheduleEnabled')}
      </label>
      <div className='grid gap-4 sm:grid-cols-2'>
        <label className='space-y-1.5 text-sm'>
          {t('agent')}
          <select
            required={value.enabled}
            className={selectClass}
            value={value.agentId ?? ''}
            onChange={(event) =>
              setValue({ ...value, agentId: event.target.value || null })
            }
          >
            <option value=''>{t('chooseAgent')}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label className='space-y-1.5 text-sm'>
          {t('timezone')}
          <Input
            value={value.timezone}
            aria-invalid={!isTimezone(value.timezone)}
            onChange={(event) =>
              setValue({ ...value, timezone: event.target.value })
            }
            list='report-timezones'
            required
          />
          <datalist id='report-timezones'>
            {[
              'UTC',
              'Asia/Shanghai',
              'Australia/Melbourne',
              'America/New_York',
              'Europe/London',
            ].map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <label className='space-y-1.5 text-sm'>
          {t('hour')}
          <Input
            type='number'
            min={0}
            max={23}
            step={1}
            value={value.hour}
            required
            onChange={(event) =>
              setValue({ ...value, hour: Number(event.target.value) })
            }
          />
        </label>
        <label className='space-y-1.5 text-sm'>
          {t('language')}
          <select
            className={selectClass}
            value={value.locale}
            onChange={(event) =>
              setValue({
                ...value,
                locale: event.target.value === 'zh-CN' ? 'zh-CN' : 'en',
              })
            }
          >
            <option value='en'>{t('english')}</option>
            <option value='zh-CN'>{t('chinese')}</option>
          </select>
        </label>
      </div>
      <p className='text-xs leading-5 text-muted-foreground'>
        {t('configuredOwner')}
      </p>
      {save.isError ? (
        <p role='alert' className='text-sm text-destructive'>
          {t('mutationError')}
        </p>
      ) : null}
      {save.isSuccess ? (
        <p role='status' className='text-sm text-muted-foreground'>
          {t('saved')}
        </p>
      ) : null}
      <Button
        type='submit'
        disabled={
          save.isPending ||
          !isTimezone(value.timezone) ||
          (value.enabled && !value.agentId)
        }
      >
        {t(save.isPending ? 'saving' : 'save')}
      </Button>
    </form>
  );
}
export function ReportSettings({
  projectId,
  agents,
}: {
  projectId: string;
  agents: readonly AgentOption[];
}): ReactElement {
  const { t } = useTranslation();
  const api = useReportsApi();
  const query = useQuery({
    queryKey: [...reportKeys, 'settings', projectId],
    queryFn: () => api.settings(projectId),
  });
  return (
    <details className='rounded-xl border bg-card p-5'>
      <summary className='cursor-pointer text-sm font-medium'>
        {t('configure')}
      </summary>
      <div className='mt-4'>
        {query.isPending ? (
          <p role='status'>{t('loading')}</p>
        ) : query.isError ? (
          <p role='alert' className='text-destructive'>
            {t('error')}
          </p>
        ) : (
          <SettingsForm
            key={projectId}
            projectId={projectId}
            initial={query.data}
            agents={agents}
          />
        )}
      </div>
    </details>
  );
}
