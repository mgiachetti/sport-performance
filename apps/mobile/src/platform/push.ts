import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform as ReactNativePlatform } from 'react-native';
import { PUSH_ANDROID_CHANNEL_ID } from '../config/expo-config.ts';
import {
  PushUnavailableError,
  type PushDevice,
  type PushPermission,
} from '../notifications/registration.ts';

/**
 * The phone's notifications (`expo-notifications`) behind `PushDevice`
 * (B-510, ADR 0081). Only remote pushes of the worker (ADR 0054): the app
 * schedules nothing locally.
 */

/** iOS "provisional" and "ephemeral" deliver the push (quietly): they count as allowed. */
const IOS_DELIVERING: readonly Notifications.IosAuthorizationStatus[] = [
  Notifications.IosAuthorizationStatus.PROVISIONAL,
  Notifications.IosAuthorizationStatus.EPHEMERAL,
];

function permissionOf(response: Notifications.NotificationPermissionsStatus): PushPermission {
  const delivering = response.ios !== undefined && IOS_DELIVERING.includes(response.ios.status);
  if (response.granted || delivering) {
    return { status: 'granted', canAskAgain: response.canAskAgain };
  }
  const status: string = response.status;
  return {
    status: status === 'denied' ? 'denied' : 'undetermined',
    canAskAgain: response.canAskAgain,
  };
}

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const projectId = extra?.eas?.projectId;
  return typeof projectId === 'string' && projectId !== '' ? projectId : null;
}

let configured = false;

/** Once per process: how a push shows with the app open, and the Android channel. */
function configure(channelName: string, reportError: (error: unknown) => void): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    // With the app open the push still shows as a banner: an alert is something to look at now.
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });
  if (ReactNativePlatform.OS === 'android') {
    Notifications.setNotificationChannelAsync(PUSH_ANDROID_CHANNEL_ID, {
      name: channelName,
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(reportError);
  }
}

export function createNativePushDevice(options: {
  /** Name of the Android channel, in the user's language. */
  readonly channelName: string;
  readonly reportError: (error: unknown) => void;
}): PushDevice {
  configure(options.channelName, options.reportError);
  const projectId = easProjectId();
  const platform = ReactNativePlatform.OS === 'android' ? 'android' : 'ios';
  // The Expo token needs the EAS project. A simulator may still get one (a
  // modern iOS simulator does): it is tried, and when it does not come on a
  // simulator or an emulator, the build gets no notifications (not `pending`).
  const supported = projectId !== null;
  return {
    platform,
    supported,
    getPermission: async () => permissionOf(await Notifications.getPermissionsAsync()),
    requestPermission: async () =>
      permissionOf(
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowBadge: false, allowSound: true },
        }),
      ),
    async getToken() {
      if (projectId === null) throw new Error('No EAS project id: this build has no push');
      try {
        const token = await Notifications.getExpoPushTokenAsync({ projectId });
        return token.data;
      } catch (error) {
        if (!Device.isDevice) throw new PushUnavailableError({ cause: error });
        throw error;
      }
    },
    onTokenChange(listener) {
      const subscription = Notifications.addPushTokenListener(() => {
        listener();
      });
      return () => {
        subscription.remove();
      };
    },
    onResponse(listener) {
      const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        listener(response.notification.request.content.data);
      });
      return () => {
        subscription.remove();
      };
    },
    takeLaunchResponse() {
      const response = Notifications.getLastNotificationResponse();
      if (response === null) return Promise.resolve(null);
      // Once: a later launch without a tap must not open it again.
      Notifications.clearLastNotificationResponse();
      return Promise.resolve(response.notification.request.content.data);
    },
    openSettings: () => Linking.openSettings(),
  };
}
