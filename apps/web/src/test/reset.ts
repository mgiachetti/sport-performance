import { onlineManager } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';

/**
 * Leaves the document and the process-wide state as a fresh test expects
 * them: unmounts what was rendered, empties the storages, drops the brand
 * and theme the app put on `<html>` and puts TanStack Query back online (its
 * online state is a process-wide singleton).
 */
export function resetTestEnvironment(): void {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
  onlineManager.setOnline(true);
}
