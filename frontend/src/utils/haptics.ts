import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

// Apple §13: reserve haptics for meaningful moments (commit, success, error,
// snap) and fire them on the same frame as the visual. Centralised here so
// every screen speaks the same haptic language. All calls are best-effort and
// no-op on web (expo-haptics already no-ops, but we skip the call outright).
const on = Platform.OS !== 'web';

export const haptics = {
  // A control settled into a new state — segment switch, toggle, tab.
  selection() { if (on) Haptics.selectionAsync().catch(() => {}); },
  // A light tap for a routine commit (entry added, item saved).
  impact() { if (on) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  // A meaningful success — punch recorded, bill generated, payroll run.
  success() { if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
  // Something went wrong the user should feel.
  error() { if (on) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
};
