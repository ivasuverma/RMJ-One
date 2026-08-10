import { Alert, Platform } from 'react-native';

/**
 * Cross-platform destructive-action confirmation. React Native's `Alert.alert`
 * with multiple buttons is unreliable on web (react-native-web's polyfill has
 * historically had gaps depending on version, and it's easy for a delete
 * button to silently do nothing there) — this uses the browser's native
 * `window.confirm` on web, which is guaranteed to work, and falls back to
 * `Alert.alert` on iOS/Android.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
