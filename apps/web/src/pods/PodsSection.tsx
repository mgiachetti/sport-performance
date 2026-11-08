import {
  ApiError,
  type EndpointOutput,
  type Pod,
  type listPodCategories,
} from '@sport-performance/contracts';
import {
  POD_NUMBER_MAX,
  POD_NUMBER_MIN,
  can,
  isPodSerial,
  normalizePodSerial,
  type PodStatus,
} from '@sport-performance/domain';
import { formatDateTime, formatNumber } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { StatusLabel } from '../ui/fields';
import { ActionError, AdminSection, ConfirmAction } from '../admin/parts';
import { fleetQuery, podCategoriesQuery, podsKey } from './queries';

type PodCategory = EndpointOutput<typeof listPodCategories>['items'][number];

const STATUS_LEVEL: Record<PodStatus, 'ok' | 'warning' | 'critical' | 'info'> = {
  active: 'ok',
  lent: 'info',
  lost: 'critical',
  stolen: 'critical',
  retired: 'info',
};

/** The status of a pod: always icon + text. */
export function PodStatusLabel(props: { status: PodStatus }) {
  const t = useT();
  return (
    <StatusLabel level={STATUS_LEVEL[props.status]}>{t(`pods.status.${props.status}`)}</StatusLabel>
  );
}

/** A number typed by the staff: an integer of the pod range, or `null`. */
export function parsePodNumber(text: string): number | null {
  const value = Number(text.trim());
  return text.trim() !== '' &&
    Number.isInteger(value) &&
    value >= POD_NUMBER_MIN &&
    value <= POD_NUMBER_MAX
    ? value
    : null;
}

function useRefreshPods() {
  const { queryClient } = useServices();
  const { selection } = useActiveClub();
  return () => queryClient.invalidateQueries({ queryKey: podsKey(selection) });
}

/**
 * The pod fleet of the club in the administration (B-912, ADR 0106): its
 * pods with their number, serial, status and last health; register one by
 * its serial (the QR) and number; mark it lost or stolen (its keys are
 * revoked), recover or retire it; and the categories with pods. S&C and the
 * administration (`pod.manage`); the categories, the administration.
 */
export function PodsSection() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const fleet = useQuery(fleetQuery(api, active.selection));
  const manageCategories = can(active.subject, 'manage', {
    kind: 'category',
    clubId: active.subject.clubId,
  });

  return (
    <>
      <AdminSection id="admin-pods" title={t('pods.fleet.title')} intro={t('pods.fleet.intro')}>
        {fleet.isPending ? (
          <Loading />
        ) : fleet.isError ? (
          <ErrorNotice error={fleet.error} />
        ) : (
          <FleetTable pods={fleet.data} />
        )}
      </AdminSection>
      <AdminSection
        id="admin-pod-new"
        title={t('pods.register.title')}
        intro={t('pods.register.intro')}
      >
        <RegisterPodForm />
      </AdminSection>
      {manageCategories ? <PodCategoriesSection /> : null}
    </>
  );
}

function FleetTable(props: { pods: readonly Pod[] }) {
  const t = useT();
  const { club } = useActiveClub();
  if (props.pods.length === 0) return <p className="sp-admin__meta">{t('pods.fleet.empty')}</p>;
  return (
    <div className="sp-table-wrap">
      <table className="sp-table">
        <caption className="sp-visually-hidden">{t('pods.fleet.title')}</caption>
        <thead>
          <tr>
            <th scope="col" className="sp-table__number">
              {t('pods.fleet.number')}
            </th>
            <th scope="col">{t('pods.fleet.serial')}</th>
            <th scope="col">{t('pods.fleet.status')}</th>
            <th scope="col">{t('pods.fleet.lastSeen')}</th>
            <th scope="col" className="sp-table__number">
              {t('pods.fleet.battery')}
            </th>
            <th scope="col">{t('pods.fleet.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {props.pods.map((pod) => (
            <tr key={pod.id}>
              <th scope="row" className="sp-table__number">
                {pod.number}
              </th>
              <td>
                {pod.serialNumber}
                {pod.borrowedFromClubId === null ? null : (
                  <span className="sp-admin__meta"> · {t('pods.fleet.borrowed')}</span>
                )}
              </td>
              <td>
                <PodStatusLabel status={pod.status} />
              </td>
              <td>
                {pod.health.lastSeenAt === null
                  ? t('pods.fleet.never')
                  : formatDateTime(new Date(pod.health.lastSeenAt), { timeZone: club.timeZone })}
              </td>
              <td className="sp-table__number">
                {pod.health.batteryCapacityPct === null
                  ? formatNumber(null)
                  : `${formatNumber(pod.health.batteryCapacityPct, { maxDecimals: 0 })} %`}
              </td>
              <td>
                <PodActions pod={pod} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PodActions(props: { pod: Pod }) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshPods();
  const { pod } = props;
  const params = { params: { podId: pod.id } };
  const missing = useMutation({
    mutationFn: (status: 'lost' | 'stolen') => api.markPodMissing({ ...params, body: { status } }),
    onSettled: refresh,
  });
  const recover = useMutation({ mutationFn: () => api.recoverPod(params), onSettled: refresh });
  const retire = useMutation({ mutationFn: () => api.retirePod(params), onSettled: refresh });
  const own = pod.borrowedFromClubId === null;
  const error = missing.error ?? recover.error ?? retire.error;
  return (
    <div className="sp-admin__row-actions">
      {pod.status === 'active' && own ? (
        <>
          <ConfirmAction
            label={t('pods.action.lost')}
            question={t('pods.action.lostQuestion', { number: pod.number })}
            pending={missing.isPending}
            size="sm"
            onConfirm={() => {
              missing.mutate('lost');
            }}
          />
          <ConfirmAction
            label={t('pods.action.stolen')}
            question={t('pods.action.stolenQuestion', { number: pod.number })}
            pending={missing.isPending}
            variant="ghost"
            size="sm"
            onConfirm={() => {
              missing.mutate('stolen');
            }}
          />
        </>
      ) : null}
      {pod.status === 'lost' || pod.status === 'stolen' ? (
        <Button
          variant="secondary"
          size="sm"
          title={t('pods.action.recoverHelp')}
          disabled={recover.isPending}
          onClick={() => {
            recover.mutate();
          }}
        >
          {t('pods.action.recover')}
        </Button>
      ) : null}
      {pod.status !== 'lent' && own ? (
        <ConfirmAction
          label={t('pods.action.retire')}
          question={t('pods.action.retireQuestion', { number: pod.number })}
          pending={retire.isPending}
          variant="ghost"
          size="sm"
          onConfirm={() => {
            retire.mutate();
          }}
        />
      ) : null}
      <ActionError error={error} conflictText={t('pods.action.conflict')} />
    </div>
  );
}

function RegisterPodForm() {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshPods();
  const [serial, setSerial] = useState('');
  const [numberText, setNumberText] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const serialNumber = normalizePodSerial(serial);
  const serialOk = isPodSerial(serialNumber);
  const number = parsePodNumber(numberText);

  const register = useMutation({
    mutationFn: (body: { serialNumber: string; number: number }) =>
      api.registerPod({ body: { clientUuid, ...body } }),
    onSuccess: (pod) => {
      setDone(pod.number);
      setSerial('');
      setNumberText('');
      setSubmitted(false);
      setClientUuid(crypto.randomUUID());
    },
    onSettled: refresh,
  });
  const touch = () => {
    setDone(null);
    setClientUuid(crypto.randomUUID());
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (serialOk && number !== null) register.mutate({ serialNumber, number });
  };

  const notFound = register.error instanceof ApiError && register.error.code === 'not_found';
  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      <div className="sp-form__row">
        <TextField
          label={t('pods.register.serial')}
          value={serial}
          autoComplete="off"
          error={submitted && !serialOk ? t('pods.register.invalidSerial') : null}
          onChange={(event) => {
            setSerial(event.target.value);
            touch();
          }}
        />
        <TextField
          label={t('pods.register.number')}
          inputMode="numeric"
          value={numberText}
          error={
            submitted && number === null
              ? t('pods.register.invalidNumber', { min: POD_NUMBER_MIN, max: POD_NUMBER_MAX })
              : null
          }
          onChange={(event) => {
            setNumberText(event.target.value);
            touch();
          }}
        />
      </div>
      {notFound ? (
        <Notice level="warning" role="alert">
          <p>{t('pods.register.notFound')}</p>
        </Notice>
      ) : (
        <ActionError error={register.error} conflictText={t('pods.register.conflict')} />
      )}
      {done === null ? null : (
        <Notice level="ok" role="status">
          <p>{t('pods.register.done', { number: done })}</p>
        </Notice>
      )}
      <div className="sp-form__actions">
        <Button type="submit" disabled={register.isPending}>
          {t('pods.register.submit')}
        </Button>
      </div>
    </form>
  );
}

function PodCategoriesSection() {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const categories = useQuery(podCategoriesQuery(api, active.selection));
  const names = new Map(active.categories.map((c) => [c.id as string, c.name]));
  return (
    <AdminSection
      id="admin-pod-categories"
      title={t('pods.categories.title')}
      intro={t('pods.categories.intro')}
    >
      {categories.isPending ? (
        <Loading />
      ) : categories.isError ? (
        <ErrorNotice error={categories.error} />
      ) : categories.data.items.length === 0 ? (
        <p className="sp-admin__meta">{t('pods.categories.empty')}</p>
      ) : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('pods.categories.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('pods.categories.category')}</th>
                <th scope="col">{t('pods.fleet.status')}</th>
                <th scope="col">{t('pods.fleet.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {categories.data.items.map((item) => (
                <PodCategoryRow
                  key={item.categoryId}
                  item={item}
                  name={names.get(item.categoryId) ?? item.categoryId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSection>
  );
}

function PodCategoryRow(props: { item: PodCategory; name: string }) {
  const t = useT();
  const { api } = useServices();
  const queryClient = useQueryClient();
  const { selection } = useActiveClub();
  const { item } = props;
  const toggle = useMutation({
    mutationFn: () =>
      api.setPodCategory({
        params: { categoryId: item.categoryId },
        body: { podsEnabled: !item.podsEnabled },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: podsKey(selection) }),
  });
  return (
    <tr>
      <th scope="row">{props.name}</th>
      <td>
        {item.podsEnabled ? (
          <StatusLabel level="ok">{t('pods.categories.enabled')}</StatusLabel>
        ) : (
          <StatusLabel level="info">{t('pods.categories.disabled')}</StatusLabel>
        )}
      </td>
      <td>
        <Button
          variant="secondary"
          size="sm"
          disabled={toggle.isPending}
          aria-label={`${t(item.podsEnabled ? 'pods.categories.disable' : 'pods.categories.enable')} ${props.name}`}
          onClick={() => {
            toggle.mutate();
          }}
        >
          {t(item.podsEnabled ? 'pods.categories.disable' : 'pods.categories.enable')}
        </Button>
        <ActionError error={toggle.error} />
      </td>
    </tr>
  );
}
