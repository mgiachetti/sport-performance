import { ApiError } from '@sport-performance/contracts';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useServices } from '../app/services';

/**
 * Signs out (`POST /v1/auth/sign-out` revokes the session and clears the
 * cookie) and forgets everything local: cache, club and support selection,
 * so the next person on a shared computer starts clean. If the API cannot be
 * reached the session would stay open, so the user stays and sees the error.
 */
export function useSignOut() {
  const { api, queryClient, selection } = useServices();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async () => {
      try {
        await api.signOut();
      } catch (error) {
        // Already gone (expired or revoked elsewhere): signed out anyway.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
    },
    retry: false,
    onSuccess: async () => {
      queryClient.clear();
      selection.select(null);
      await navigate({ to: '/login', replace: true });
    },
  });
}
