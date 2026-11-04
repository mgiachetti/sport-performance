import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import { StaffBoardScreen } from '../../src/screens/staff.tsx';
import {
  boardCategories,
  boardClubDay,
  boardOpeningKey,
  buildBoard,
  canSeeStaffBoard,
} from '../../src/staff/board.ts';
import { useKeyedState } from '../../src/state/keyed-state.ts';
import { useNow, useServices, useSession } from '../../src/state/app-context.tsx';
import {
  usePushState,
  useSessionCategory,
  useStaffCategories,
  useStaffPanel,
  useWellnessPlayersOn,
} from '../../src/state/staff-data.ts';
import { useTranslator } from '../../src/ui/i18n.tsx';

/**
 * The staff's quick look before training (B-510): the panel of the API kept
 * on the phone, with the wellness the sync brought after it. Opened from the
 * summary push with `?sessionId=`, it starts filtered by that session's category.
 */
export default function StaffBoard() {
  const services = useServices();
  const state = useSession();
  const translator = useTranslator();
  const now = useNow();
  const push = usePushState();
  const { sessionId, tap } = useLocalSearchParams<{ sessionId?: string; tap?: string }>();
  const role = state.status === 'signedIn' ? (state.activeMembership?.role ?? null) : null;
  const allowed = role !== null && canSeeStaffBoard(role);
  const panel = useStaffPanel(allowed);
  const categories = useStaffCategories(allowed);
  // Today, not the panel's day: a panel kept from yesterday and opened
  // without signal reads today's wellness only from what the sync brought.
  const today =
    panel.value === undefined ? null : boardClubDay(panel.value.today, panel.fetchedAt, now);
  const wellness = useWellnessPlayersOn(today);
  const session = useSessionCategory(typeof sessionId === 'string' ? sessionId : null);
  // `undefined` until the person picks one: then the category of the session
  // of the summary push (once the phone knows it), or every category. The
  // tab stays mounted, so the pick belongs to one opening: every tap on a
  // push (`tap`, even of the same session) starts again from its session.
  const [chosen, setChosen] = useKeyedState<string | null | undefined>(
    boardOpeningKey(sessionId, tap),
    undefined,
  );
  const categoryId = chosen !== undefined ? chosen : (session?.categoryId ?? null);

  const chips = useMemo(
    () => (panel.value === undefined ? [] : boardCategories(panel.value, categories.value ?? [])),
    [panel.value, categories.value],
  );
  const board = useMemo(
    () =>
      panel.value === undefined || today === null
        ? null
        : buildBoard({
            panel: panel.value,
            today,
            categories: categories.value ?? [],
            categoryId,
            wellnessPlayerIds: wellness,
          }),
    [panel.value, today, categories.value, categoryId, wellness],
  );

  if (!allowed) return null;
  return (
    <StaffBoardScreen
      board={board}
      loading={panel.loading}
      error={panel.error === null ? null : errorMessage(panel.error, 'generic', translator)}
      freshness={{ fetchedAt: panel.fetchedAt, fromCache: panel.fromCache, nowMs: now }}
      categories={chips}
      categoryId={categoryId}
      sessionFilter={
        session !== null && categoryId !== null && categoryId === session.categoryId
          ? (session.title ?? '')
          : null
      }
      push={push}
      onSelectCategory={setChosen}
      onOpenAlert={(alertId) => {
        router.push({ pathname: '/alerts/[alertId]', params: { alertId } });
      }}
      onRetry={() => {
        panel.refetch();
        categories.refetch();
        services.sync.requestSync({ force: true });
      }}
      onEnablePush={() => {
        services.push.enable().catch(services.reportError);
      }}
    />
  );
}
