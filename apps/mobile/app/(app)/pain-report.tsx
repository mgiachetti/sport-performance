import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { EMPTY_PAIN_DRAFT, painReportMutation, type PainDraft } from '../../src/pain/draft.ts';
import { painQuestionState } from '../../src/pain/question.ts';
import { PainReportScreen, type PainSentState } from '../../src/screens/pain-report.tsx';
import {
  useApi,
  useNow,
  useServices,
  useSession,
  useSyncStatus,
} from '../../src/state/app-context.tsx';
import { clubDay, useMyPlayer } from '../../src/state/player-screens.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';

/**
 * "¿Te duele algo?" of the wellness (B-609, ADR 0078), opened after the
 * check-in. Whether to ask comes from the server: today's form, or without
 * signal the player's kept profile (`permissions.reportPain`). The answer
 * goes to the offline queue (`pain_report.submit`, with its `clientUuid` and
 * the club day from the phone's clock) and leaves the phone once the server
 * applied it. The draft lives only in memory.
 */
export default function PainReport() {
  const services = useServices();
  const api = useApi();
  const queryClient = useQueryClient();
  const translator = useTranslator();
  const session = useSession();
  const syncStatus = useSyncStatus();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const membershipId = membership?.id ?? null;
  const isPlayer = membership?.role === 'player';

  const form = useQuery({
    queryKey: [membershipId, 'pain-report', 'today'],
    enabled: isPlayer,
    queryFn: ({ signal }) => api.getPainReportForm({}, { signal }),
  });
  const me = useMyPlayer();
  const now = useNow();
  const day = clubDay(me.value, now);

  // An answer still in the queue of the phone (none once the server applied it).
  const queued = useQuery({
    queryKey: [membershipId, 'pain-report', 'queued', syncStatus.pendingCount],
    enabled: membershipId !== null,
    queryFn: async () =>
      membershipId === null
        ? []
        : services.sync.store.pending(membershipId, ['pain_report.submit']),
  });

  const [draft, setDraft] = useState<PainDraft>(EMPTY_PAIN_DRAFT);
  const [justSent, setJustSent] = useState<boolean | null>(null);
  const [answeringAgain, setAnsweringAgain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isPlayer || membershipId === null) return null;

  const latest = form.data?.latest ?? null;
  const inQueue = queued.data?.at(-1);
  let sent: PainSentState | null = null;
  if (!answeringAgain) {
    if (justSent !== null || inQueue !== undefined) {
      sent = {
        hasPain: justSent ?? inQueue?.input.body.hasPain ?? false,
        queued: inQueue !== undefined,
        reviewed: false,
      };
    } else if (latest !== null) {
      sent = { hasPain: latest.hasPain, queued: false, reviewed: latest.reviewedAt !== null };
    }
  }

  async function submit(answerDraft: PainDraft) {
    if (membershipId === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await services.sync.enqueue(
        'pain_report.submit',
        painReportMutation(answerDraft, {
          clientUuid: services.randomUUID(),
          ...(day !== null && { localDate: day.today }),
        }),
      );
      services.sync.requestSync();
      setJustSent(answerDraft.hasPain === true);
      setAnsweringAgain(false);
      setDraft(EMPTY_PAIN_DRAFT);
      await queryClient.invalidateQueries({ queryKey: [membershipId, 'pain-report'] });
    } catch (cause) {
      services.reportError(cause);
      setError(translator.t('pain.error.queue'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PainReportScreen
      question={painQuestionState({
        form: form.data,
        failed: form.isError,
        profileAsks: me.value?.permissions.reportPain,
      })}
      draft={draft}
      onChange={setDraft}
      onSubmit={(next) => {
        void submit(next);
      }}
      submitting={submitting}
      sent={sent}
      onAnswerAgain={() => {
        setAnsweringAgain(true);
        setJustSent(null);
      }}
      error={error}
    />
  );
}
