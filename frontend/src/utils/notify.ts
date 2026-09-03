import { Alert, Platform } from 'react-native';

/**
 * Cross-platform info/error messaging. React Native Web's Alert.alert is a
 * total no-op — `static alert() {}`, see node_modules/react-native-web/src/
 * exports/Alert — so every Alert.alert call, single-button included, silently
 * does nothing in the browser: no dialog, no error, the screen just looks
 * dead. window.alert is the web-safe equivalent; native keeps Alert.alert.
 */
export function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
