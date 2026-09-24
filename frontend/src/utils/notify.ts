import { Alert, Platform } from 'react-native';
import { showToast, ToastKind } from '@/src/components/ui/Toast';

const SUCCESS = /^(ready|sent|saved|done|submitted|sync requested|marked as left)$|generated$/i;
const INFO = /^(preview|preview only|partial success|already there|nothing to reset|no changes|not supported)$/i;

function kindOf(title: string): ToastKind {
  if (SUCCESS.test(title.trim())) return 'success';
  if (INFO.test(title.trim())) return 'info';
  return 'error';
}

/**
 * Cross-platform info/error messaging, shown as an in-app toast (see
 * ToastProvider) instead of a blocking dialog. Falls back to window.alert on
 * web / Alert.alert on native only if no ToastProvider is mounted —
 * react-native-web's Alert.alert is a no-op, so web never relies on it.
 */
export function notify(title: string, message: string) {
  if (showToast(kindOf(title), message, title)) return;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
