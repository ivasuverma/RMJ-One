import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// A thin banner shown only while the browser reports it's offline, so a
// dropped connection is visible instead of the app silently failing (the
// shop's local-first requirement — staff keep working through an ISP blip).
// Web-only: React Native has no navigator.onLine equivalent here, and the
// native builds aren't the deployment target.
export function OfflineBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]} testID="offline-banner">
      <Ionicons name="cloud-offline-outline" size={14} color={colors.onWarning} />
      <Text style={styles.text}>You&apos;re offline — showing the last loaded data.</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, zIndex: 50,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.warning, borderColor: colors.onWarning, borderWidth: 1,
    borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: spacing.md,
  },
  text: { color: colors.onWarning, fontSize: 12, fontWeight: '700' },
});
