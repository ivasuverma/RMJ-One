import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { notify } from '@/src/utils/notify';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import {
  isQuickUnlockSupported, isQuickUnlockEnabled, enableQuickUnlock, disableQuickUnlock,
} from '@/src/utils/quickUnlock';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Self-contained Quick Unlock control. Drop it into any settings surface — it
// reads its own state (supported? enabled?) and toggles enrollment on this
// device for the signed-in account. Enrollment is device-bound; a new device
// still needs the password.
export function QuickUnlockCard() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [s, e] = await Promise.all([isQuickUnlockSupported(), isQuickUnlockEnabled()]);
    setSupported(s);
    setEnabled(e);
  }, []);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const enable = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const res = await enableQuickUnlock(user.id, user.username, user.name);
      if (res.ok) setEnabled(true);
      else if (res.reason && res.reason !== 'Cancelled') notify('Couldn’t enable', res.reason);
    } finally { setBusy(false); }
  };

  const disable = () => {
    confirmAction(
      'Turn off quick unlock?',
      'This device will ask for your username and password on the next sign-in.',
      'Turn off',
      async () => { await disableQuickUnlock(); setEnabled(false); },
    );
  };

  if (supported === null) {
    return <View style={styles.card}><ActivityIndicator color={colors.brandSecondary} /></View>;
  }

  if (!supported) {
    return (
      <View style={styles.card} testID="quick-unlock-card">
        <View style={[styles.iconBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Ionicons name="finger-print-outline" size={18} color={colors.mutedText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Quick unlock</Text>
          <Text style={styles.meta}>Face ID / fingerprint unlock isn’t available on this device or browser.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="quick-unlock-card">
      <View style={styles.iconBox}>
        <Ionicons name="finger-print" size={18} color={colors.brandSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>Quick unlock</Text>
        <Text style={styles.meta}>
          {enabled
            ? 'On for this device — reopen with Face ID / fingerprint instead of your password.'
            : 'Reopen the app with Face ID / fingerprint on this device. Your password is still needed on other devices.'}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator color={colors.brandSecondary} />
      ) : enabled ? (
        <Pressable onPress={disable} style={[styles.btn, styles.btnOff]} testID="quick-unlock-disable">
          <Text style={styles.btnOffText}>Turn off</Text>
        </Pressable>
      ) : (
        <Pressable onPress={enable} style={[styles.btn, styles.btnOn]} testID="quick-unlock-enable">
          <Text style={styles.btnOnText}>Turn on</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  name: { color: colors.onSurface, fontWeight: '700', fontSize: 14 },
  meta: { color: colors.onSurfaceTertiary, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1 },
  btnOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  btnOnText: { color: colors.onBrandPrimary, fontSize: 12.5, fontWeight: '800' },
  btnOff: { backgroundColor: colors.surface, borderColor: colors.border },
  btnOffText: { color: colors.onSurfaceSecondary, fontSize: 12.5, fontWeight: '800' },
});
