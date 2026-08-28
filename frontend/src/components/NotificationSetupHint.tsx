import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Guides the user to actually receive push on their phone. On iPhone, web push
// ONLY works when the app is installed to the Home Screen — so we detect that
// case and tell them how. Otherwise, if permission isn't granted yet, we nudge
// them to turn it on. Renders nothing once everything's set up.
export function NotificationSetupHint() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [dismissed, setDismissed] = useState(false);

  const state = useMemo(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || typeof window === 'undefined') return 'ok';
    const ua = navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua) || ((navigator as any).platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (window.navigator as any).standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    const perm = typeof Notification !== 'undefined' ? Notification.permission : 'default';
    if (isIOS && !standalone) return 'install-ios';
    if (perm !== 'granted') return 'enable';
    return 'ok';
  }, []);

  if (dismissed || state === 'ok') return null;

  const isInstall = state === 'install-ios';
  return (
    <View style={styles.card} testID="notif-setup-hint">
      <Ionicons name={isInstall ? 'phone-portrait-outline' : 'notifications-outline'} size={18} color={colors.onWarning} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{isInstall ? 'Get alerts on this iPhone' : 'Turn on notifications'}</Text>
        <Text style={styles.body}>
          {isInstall
            ? 'iPhone only shows notifications when the app is on your Home Screen. Tap the Share button (□↑) in Safari → "Add to Home Screen", then open RMJ One from that icon and turn notifications on.'
            : 'Open Notifications below and toggle it on — then allow it when your phone asks.'}
        </Text>
      </View>
      <Pressable onPress={() => setDismissed(true)} hitSlop={10} testID="notif-hint-dismiss">
        <Ionicons name="close" size={18} color={colors.onWarning} />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.warning, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  title: { color: colors.onWarning, fontSize: 13.5, fontWeight: '800' },
  body: { color: colors.onWarning, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
});
