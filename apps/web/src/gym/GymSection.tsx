import { ApiError, type GymSet } from '@sport-performance/contracts';
import { LineChart } from '@sport-performance/charts/web';
import {
  GYM_LIBRARY_EXERCISE_CODES,
  gymLibraryExercise,
  localDateInTimeZone,
  type PlayerId,
} from '@sport-performance/domain';
import {
  formatDuration,
  formatLocalDate,
  formatUnit,
  parseNumber,
  type MessageKey,
} from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Section } from '../pages/players/sections';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { exerciseLabel, issuePaths } from './model';
import { gymKey, playerGymSetsQuery, playerGymSummaryQuery } from './queries';

/**
 * Gym block of the player profile (B-607): the best e1RM of each exercise
 * with its evolution (chart with its table) and the latest sets with their
 * warnings. The S&C staff loads a set (with the technique score) and voids
 * one loaded by mistake, with a reason; nothing is deleted.
 */
export function GymSection(props: {
  playerId: PlayerId;
  playerName: string;
  allowed: boolean;
  canLog: boolean;
}) {
  const t = useT();
  return (
    <Section
      id="player-gym"
      title={t('gym.web.player.title')}
      subtitle={t('gym.web.player.subtitle')}
      allowed={props.allowed}
      wide
    >
      {props.allowed ? (
        <>
          <Summary playerId={props.playerId} playerName={props.playerName} />
          {props.canLog ? <LogSetForm playerId={props.playerId} /> : null}
          <RecentSets playerId={props.playerId} canVoid={props.canLog} />
        </>
      ) : null}
    </Section>
  );
}

function Summary(props: { playerId: PlayerId; playerName: string }) {
  const t = useT();
  const { api, selection } = useServices();
  const query = useQuery(playerGymSummaryQuery(api, selection.get(), props.playerId));
  const estimated = query.data?.exercises.filter((e) => e.bestE1rmKg !== null) ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  if (query.isPending) return <Loading />;
  if (query.error !== null) return <ErrorNotice error={query.error} />;
  if (query.data.exercises.length === 0) {
    return (
      <Notice level="info">
        <p>{t('gym.web.player.empty')}</p>
      </Notice>
    );
  }
  const shown = estimated.find((e) => e.exerciseCode === chosen) ?? estimated[0];
  const label = (code: string) => exerciseLabel(t, code, null);
  return (
    <>
      <div className="sp-table-wrap">
        <table className="sp-table">
          <caption>{t('gym.web.player.best')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('gym.web.col.exercise')}</th>
              <th scope="col">{t('gym.e1rm')}</th>
              <th scope="col">{t('gym.web.col.bestOn')}</th>
              <th scope="col">{t('gym.web.col.sets')}</th>
              <th scope="col">{t('gym.web.col.lastOn')}</th>
            </tr>
          </thead>
          <tbody>
            {query.data.exercises.map((exercise) => (
              <tr key={exercise.exerciseCode}>
                <th scope="row">{label(exercise.exerciseCode)}</th>
                <td>
                  {exercise.bestE1rmKg === null
                    ? t('gym.web.player.noE1rm')
                    : formatUnit(exercise.bestE1rmKg, 'kg', { decimals: 1 })}
                </td>
                <td>{exercise.bestOn === null ? '—' : formatLocalDate(exercise.bestOn)}</td>
                <td>{exercise.setsN}</td>
                <td>{formatLocalDate(exercise.lastPerformedOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sp-profile__subtitle">{t('gym.e1rm.help')}</p>
      {shown === undefined ? null : (
        <>
          <SelectField
            label={t('gym.web.player.chartExercise')}
            value={shown.exerciseCode}
            options={estimated.map((e) => ({
              value: e.exerciseCode,
              label: label(e.exerciseCode),
            }))}
            onChange={(event) => {
              setChosen(event.target.value);
            }}
          />
          <LineChart
            description={t('gym.web.player.chartDescription')}
            spec={{
              title: t('gym.web.player.chartTitle', { exercise: label(shown.exerciseCode) }),
              format: { unit: 'kg' },
              categories: shown.series.map((point) => ({
                key: point.on,
                label: formatLocalDate(point.on).slice(0, 5),
              })),
              series: [
                {
                  id: 'player',
                  role: 'player',
                  label: props.playerName,
                  values: shown.series.map((point) => point.e1rmKg),
                },
              ],
            }}
          />
        </>
      )}
    </>
  );
}

function setValue(t: ReturnType<typeof useT>, set: GymSet): string {
  if (set.durationS !== null) return formatDuration(set.durationS);
  const reps = t('gym.set.reps', { reps: set.reps ?? 0 });
  if (set.loadKg === null) return reps;
  const load = formatUnit(set.loadKg, 'kg', { maxDecimals: 1 });
  return t('gym.set.repsLoad', {
    reps: String(set.reps ?? 0),
    load: set.loadKind === 'bodyweight_plus' ? `+${load}` : load,
  });
}

function RecentSets(props: { playerId: PlayerId; canVoid: boolean }) {
  const t = useT();
  const { api, selection } = useServices();
  const queryClient = useQueryClient();
  const query = useQuery(playerGymSetsQuery(api, selection.get(), props.playerId));
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const voidSet = useMutation({
    mutationFn: (id: string) =>
      api.voidGymSet({ params: { gymSetId: id }, body: { reason: reason.trim() } }),
    onSuccess: async () => {
      setVoiding(null);
      setReason('');
      await queryClient.invalidateQueries({ queryKey: gymKey(selection.get(), 'player') });
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error !== null) return <ErrorNotice error={query.error} />;
  if (query.data.items.length === 0) return null;
  return (
    <div className="sp-table-wrap">
      <table className="sp-table">
        <caption>{t('gym.web.player.recent')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('gym.web.col.date')}</th>
            <th scope="col">{t('gym.web.col.exercise')}</th>
            <th scope="col">{t('gym.web.col.set')}</th>
            <th scope="col">{t('gym.web.col.value')}</th>
            <th scope="col">{t('gym.rir')}</th>
            <th scope="col">{t('gym.e1rm')}</th>
            <th scope="col">{t('gym.web.col.notes')}</th>
            {props.canVoid ? (
              <th scope="col">
                <span className="sp-visually-hidden">{t('gym.web.col.actions')}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {query.data.items.map((set) => (
            <tr key={set.id}>
              <td>{formatLocalDate(set.performedOn)}</td>
              <td>{exerciseLabel(t, set.exerciseCode, null)}</td>
              <td>{set.setNumber}</td>
              <td>{setValue(t, set)}</td>
              <td>{set.rir ?? '—'}</td>
              <td>{set.e1rmKg === null ? '—' : formatUnit(set.e1rmKg, 'kg', { decimals: 1 })}</td>
              <td>
                {set.warnings.map((warning) => (
                  <StatusLabel key={warning} level="warning">
                    {t(`gym.warning.${warning}`)}
                  </StatusLabel>
                ))}
                {set.techniqueScore === null ? null : (
                  <span>{t('gym.set.technique', { score: set.techniqueScore })}</span>
                )}
              </td>
              {props.canVoid ? (
                <td>
                  {voiding === set.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (reason.trim() !== '') voidSet.mutate(set.id);
                      }}
                    >
                      <TextField
                        label={t('gym.web.void.reason')}
                        value={reason}
                        maxLength={200}
                        onChange={(event) => {
                          setReason(event.target.value);
                        }}
                      />
                      <Button type="submit" disabled={voidSet.isPending || reason.trim() === ''}>
                        {t('gym.web.void.confirm')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setVoiding(null);
                        }}
                      >
                        {t('common.cancel')}
                      </Button>
                    </form>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setVoiding(set.id);
                        setReason('');
                      }}
                    >
                      {t('gym.web.void', { number: set.setNumber })}
                    </Button>
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {voidSet.error === null ? null : <ErrorNotice error={voidSet.error} />}
    </div>
  );
}

interface LogForm {
  readonly exerciseCode: string;
  readonly performedOn: string;
  readonly setNumber: string;
  readonly reps: string;
  readonly loadKg: string;
  readonly rir: string;
  readonly durationS: string;
  readonly techniqueScore: string;
}

function LogSetForm(props: { playerId: PlayerId }) {
  const t = useT();
  const { api, selection } = useServices();
  const active = useActiveClub();
  const queryClient = useQueryClient();
  const today = localDateInTimeZone(new Date(), active.club.timeZone);
  const initial: LogForm = {
    exerciseCode: 'push_up',
    performedOn: today,
    setNumber: '1',
    reps: '',
    loadKg: '',
    rir: '',
    durationS: '',
    techniqueScore: '',
  };
  const [form, setForm] = useState<LogForm>(initial);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const spec = gymLibraryExercise(form.exerciseCode);
  const log = useMutation({
    mutationFn: () => {
      const int = (value: string) => (value.trim() === '' ? null : Number(value.trim()));
      return api.logGymSets({
        body: {
          playerId: props.playerId,
          performedOn: form.performedOn,
          sets: [
            {
              clientUuid,
              exerciseCode: form.exerciseCode,
              setNumber: Number(form.setNumber),
              reps: spec?.measure === 'duration' ? null : int(form.reps),
              durationS: spec?.measure === 'duration' ? int(form.durationS) : null,
              loadKg:
                spec?.loadKind === 'bodyweight' || form.loadKg.trim() === ''
                  ? null
                  : (parseNumber(form.loadKg) ?? Number.NaN),
              rir: int(form.rir),
              techniqueScore: int(form.techniqueScore),
            },
          ],
        },
      });
    },
    onSuccess: async () => {
      setClientUuid(crypto.randomUUID());
      setForm({ ...form, setNumber: String(Number(form.setNumber) + 1) });
      await queryClient.invalidateQueries({ queryKey: gymKey(selection.get(), 'player') });
    },
  });
  const issues = log.error instanceof ApiError ? issuePaths(log.error.details) : new Map();
  const at = (field: string): string | null =>
    (issues.get(`sets.0.${field}`) as string | undefined) ??
    (issues.get(field) as string | undefined) ??
    null;
  const set = (field: keyof LogForm) => (event: { target: { value: string } }) => {
    setForm({ ...form, [field]: event.target.value });
  };
  return (
    <form
      className="sp-form"
      aria-label={t('gym.web.log.title')}
      onSubmit={(event) => {
        event.preventDefault();
        log.mutate();
      }}
    >
      <h3 className="sp-card__title">{t('gym.web.log.title')}</h3>
      <div className="sp-form__grid">
        <SelectField
          label={t('gym.web.col.exercise')}
          value={form.exerciseCode}
          error={at('exerciseCode')}
          options={GYM_LIBRARY_EXERCISE_CODES.map((code) => ({
            value: code,
            label: t(`gym.exercise.${code}` as MessageKey),
          }))}
          onChange={set('exerciseCode')}
        />
        <TextField
          type="date"
          label={t('gym.web.col.date')}
          value={form.performedOn}
          max={today}
          error={at('performedOn')}
          onChange={set('performedOn')}
        />
        <TextField
          label={t('gym.web.col.set')}
          inputMode="numeric"
          value={form.setNumber}
          error={at('setNumber')}
          onChange={set('setNumber')}
        />
        {spec?.measure === 'duration' ? (
          <TextField
            label={t('gym.web.exercise.durationS')}
            inputMode="numeric"
            value={form.durationS}
            error={at('durationS')}
            onChange={set('durationS')}
          />
        ) : (
          <TextField
            label={t('gym.measure.reps')}
            inputMode="numeric"
            value={form.reps}
            error={at('reps')}
            onChange={set('reps')}
          />
        )}
        {spec?.loadKind === 'bodyweight' ? null : (
          <TextField
            label={t('gym.web.log.loadKg')}
            inputMode="decimal"
            value={form.loadKg}
            error={at('loadKg')}
            onChange={set('loadKg')}
          />
        )}
        <TextField
          label={t('gym.rir')}
          help={t('gym.rir.help')}
          inputMode="numeric"
          value={form.rir}
          error={at('rir')}
          onChange={set('rir')}
        />
        <SelectField
          label={t('gym.web.log.technique')}
          value={form.techniqueScore}
          error={at('techniqueScore')}
          options={[
            { value: '', label: t('gym.web.log.techniqueNone') },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
          ]}
          onChange={set('techniqueScore')}
        />
      </div>
      <Button type="submit" disabled={log.isPending}>
        {t('gym.web.log.submit')}
      </Button>
      {log.isSuccess ? (
        <Notice level="ok" role="status">
          <p>{t('gym.web.log.done')}</p>
        </Notice>
      ) : null}
      {log.error !== null && issues.size === 0 ? <ErrorNotice error={log.error} /> : null}
    </form>
  );
}
