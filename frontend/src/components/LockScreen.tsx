import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Full-screen biometric gate shown when a valid session exists on this device
// but the user hasn't passed quick unlock yet. Rendered above everything by
// AppShell, so whatever screen is mounted underneath stays hidden.
export function LockScreen() {
  const { user, unlock, cancelQuickUnlock } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const promptedRef = useRef(false);

  const attempt = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const res = await unlock();
    if (!res.ok && res.reason && res.reason !== 'Cancelled') setError(res.reason);
    setBusy(false);
  }, [busy, unlock]);

  // Trigger the biometric prompt automatically on mount. Some browsers require
  // the very first WebAuthn call to come from a user gesture, so if this
  // auto-attempt is blocked the user just taps the Unlock button.
  useEffect(() => {
    if (promptedRef.current) return;
    promptedRef.current = true;
    attempt();
  }, [attempt]);

  return (
    <View style={styles.root} testID="lock-screen">
      <View style={styles.center}>
        <View style={styles.iconRing}>
          <Ionicons name="finger-print" size={44} color={colors.brandPrimary} />
        </View>
        <Text style={styles.title}>Locked</Text>
        <Text style={styles.subtitle}>
          {user?.name ? `Welcome back, ${user.name.split(' ')[0]}` : 'Welcome back'}
        </Text>
        {!!error && <Text style={styles.error}>{error}</Text>}

        <Pressable onPress={attempt} disabled={busy} style={[styles.unlockBtn, busy && { opacity: 0.6 }]} testID="lock-unlock-btn">
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
            <>
              <Ionicons name="finger-print" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.unlockText}>Unlock</Text>
            </>
          )}
        </Pressable>

        <Pressable onPress={cancelQuickUnlock} hitSlop={10} style={styles.pwBtn} testID="lock-use-password-btn">
          <Text style={styles.pwText}>Use password instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  center: { alignItems: 'center', paddingHorizontal: spacing.xl, gap: spacing.sm },
  iconRing: {
    width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary, marginBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: '700', fontFamily: fonts.display },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 14 },
  error: { color: colors.onError, fontSize: 12.5, marginTop: 4, textAlign: 'center' },
  unlockBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 40,
    marginTop: spacing.lg, minWidth: 200,
  },
  unlockText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: '700' },
  pwBtn: { paddingVertical: 12, marginTop: spacing.sm },
  pwText: { color: colors.brandSecondary, fontSize: 13, fontWeight: '700' },
});
