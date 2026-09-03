import { Alert, Platform } from 'react-native';

/**
 * Cross-platform "do the extra thing, or skip it" prompt — both branches
 * proceed, neither is a true cancel-and-stop (that's confirmAction, for
 * destructive confirmations). Alert.alert with multiple buttons is a total
 * no-op on web (react-native-web's Alert.alert is literally `static alert()
 * {}` — see src/utils/notify.ts), so a dialog like "Skip / Print Slip" never
 * appeared there, making an action that had already succeeded look dead.
 * window.confirm is the web-safe equivalent; native keeps Alert.alert.
 */
export function promptChoice(
  title: string,
  message: string,
  primaryLabel: string,
  onPrimary: () => void,
  onSecondary: () => void,
) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}\n\n${primaryLabel}?`)) onPrimary();
    else onSecondary();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Skip', style: 'cancel', onPress: onSecondary },
    { text: primaryLabel, onPress: onPrimary },
  ]);
}
