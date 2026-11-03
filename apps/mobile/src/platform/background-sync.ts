import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

/** The background task of the sync (ADR 0065), as `expo-background-task` registers it. */
export const BACKGROUND_SYNC_TASK = 'sport-performance.sync';
/** Minutes between runs the system is asked for (it decides; 15 is the minimum it honors). */
const MINIMUM_INTERVAL_MIN = 15;

let runner: (() => Promise<boolean>) | null = null;

// Defined when the bundle loads, as the task manager requires: a background
// launch runs the bundle and then the task.
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  if (runner === null) return BackgroundTask.BackgroundTaskResult.Failed;
  try {
    return (await runner())
      ? BackgroundTask.BackgroundTaskResult.Success
      : BackgroundTask.BackgroundTaskResult.Failed;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** What the task runs: one sync cycle; `true` when it synced. */
export function setBackgroundSyncRunner(next: () => Promise<boolean>): void {
  runner = next;
}

/** Asks the system to run the task periodically, where background work is allowed. */
export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
  if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK)) return;
  await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: MINIMUM_INTERVAL_MIN,
  });
}
