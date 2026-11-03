import { ApiContractError, type ApiClient } from '@sport-performance/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import {
  ProtocolListScreen,
  ProtocolScreen,
  type ProtocolListState,
} from '../../src/screens/protocols.tsx';
import { useApi, useServices, useSession } from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';

/** Largest page the API serves (ADR 0032). */
const PAGE_LIMIT = 100;
/** Bound on a runaway cursor: the club has a handful of tests. */
const MAX_PAGES = 10;

async function currentDefinitions(api: ApiClient, signal: AbortSignal) {
  const items = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await api.listTestDefinitions(
      { query: { limit: PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) } },
      { signal },
    );
    items.push(...result.items);
    if (result.nextCursor === null) return items;
    cursor = result.nextCursor;
  }
  return items;
}

/** Protocols tab (B-415): the tests in force in the club and the protocol of each one. */
export default function Protocols() {
  const api = useApi();
  const services = useServices();
  const state = useSession();
  const translator = useTranslator();
  const [openId, setOpenId] = useState<string | null>(null);
  const membershipId = state.status === 'signedIn' ? (state.activeMembership?.id ?? null) : null;
  const definitions = useQuery({
    // Keyed by membership: the data of one club never answers another.
    queryKey: ['club', membershipId, 'testDefinitions', 'current'],
    queryFn: ({ signal }) => currentDefinitions(api, signal),
    enabled: membershipId !== null,
    staleTime: 10 * 60_000,
  });
  const contractError = definitions.error instanceof ApiContractError ? definitions.error : null;
  useEffect(() => {
    // An off-contract answer is a bug: reported, shown as a generic error.
    if (contractError !== null) services.reportError(contractError);
  }, [contractError, services]);
  if (membershipId === null) return null;

  const open = openId === null ? undefined : definitions.data?.find((d) => d.id === openId);
  if (open !== undefined) {
    return (
      <ProtocolScreen
        definition={open}
        onBack={() => {
          setOpenId(null);
        }}
      />
    );
  }

  let listState: ProtocolListState;
  if (definitions.data !== undefined) {
    listState = { status: 'ready', definitions: definitions.data };
  } else if (definitions.isError) {
    listState = {
      status: 'error',
      message: errorMessage(definitions.error, 'generic', translator),
    };
  } else {
    listState = { status: 'loading' };
  }
  return (
    <ProtocolListScreen
      state={listState}
      offline={state.status === 'signedIn' && state.offline}
      onOpen={setOpenId}
      onRetry={() => {
        void definitions.refetch();
      }}
    />
  );
}
