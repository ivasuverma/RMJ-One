import { ReactNode, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme, ThemePreference } from '@/src/theme/ThemeContext';
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '@/src/utils/push';
import { QuickUnlockCard } from '@/src/components/QuickUnlockCard';

// Employee settings — same language as the admin Settings screen: an
// Apple-ID-style profile card at the top (all personal/contact/bank details
// folded behind it, editable via the edit-profile screen), then quiet section
// headers over full-width rows. No read-only info dump on this screen anymore.
const THEME_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export default function EmployeeProfile() {
  const { user, logout } = useAuth();
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [details, setDetails] = useState<any>(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try { setDetails(await api.get<any>('/employees/me')); }
    catch (_e) { setDetails(null); }
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    load();
    if (isPushSupported()) isSubscribed().then(setPushOn);
  }, [load]));

  const togglePush = async () => {
    if (!isPushSupported()) { notify('Not supported', 'Notifications aren’t supported in this browser.'); return; }
    setPushBusy(true);
    try {
      if (pushOn) { await unsubscribeFromPush(); setPushOn(false); }
      else {
        const res = await subscribeToPush();
        if (res.ok) setPushOn(true);
        else notify('Couldn’t enable notifications', res.reason || 'Please try again');
      }
    } finally { setPushBusy(false); }
  };

  const onLogout = async () => { await logout(); router.replace('/login'); };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-profile-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        {/* Apple-ID-style profile card — tap to edit all details */}
        <Pressable testID="emp-profile-card" onPress={() => router.push('/(emp)/edit-profile' as any)} style={({ pressed }) => [styles.profileCard, pressed && { opacity: 0.85 }]}>
          {details?.photo ? (
            <Image source={{ uri: details.photo }} style={styles.avatarPhoto} />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || 'E')[0]?.toUpperCase()}</Text></View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.role} numberOfLines={1}>{user?.employee_code} · {user?.designation || '—'}</Text>
            <Text style={styles.profileHint}>Profile, contact, bank & password</Text>
          </View>
          <Pressable onPress={onLogout} hitSlop={10} style={styles.quickLogout} testID="quick-logout-btn">
            <Ionicons name="log-out-outline" size={20} color={colors.onError} />
          </Pressable>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        {/* Preferences */}
        <Text style={styles.groupTitle}>App</Text>
        <Row
          icon="notifications-outline"
          label="Notifications"
          sub="Push alerts on this device"
          value={pushBusy ? undefined : (pushOn ? 'On' : 'Off')}
          valueTone={pushOn ? 'success' : undefined}
          trailing={pushBusy ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : undefined}
          onPress={togglePush}
          testID="emp-notifications-toggle"
        />
        <Row
          icon="contrast-outline"
          label="Appearance"
          sub="Light, dark or system"
          value={THEME_LABEL[preference]}
          onPress={() => setThemePickerOpen((v) => !v)}
          testID="emp-appearance-btn"
        />
        {themePickerOpen && (
          <View style={styles.themeRow} testID="emp-appearance-options">
            {(['system', 'light', 'dark'] as const).map((opt) => (
              <Pressable key={opt} testID={`emp-appearance-${opt}`} onPress={() => { setPreference(opt); setThemePickerOpen(false); }} style={[styles.themeOpt, preference === opt && styles.themeOptActive]}>
                <Text style={[styles.themeOptText, preference === opt && styles.themeOptTextActive]}>{THEME_LABEL[opt]}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Sign in */}
        <Text style={styles.groupTitle}>Sign in</Text>
        <QuickUnlockCard />

        <Pressable testID="emp-logout-btn-profile" style={styles.logout} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.onError} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.footer}>RMJ One · One system for the entire business</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, sub, value, valueTone, trailing, onPress, testID }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; value?: string;
  valueTone?: 'success'; trailing?: ReactNode; onPress: () => void; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} testID={testID}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={22} color={colors.brandSecondary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        {!!sub && <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {trailing ?? (value !== undefined ? (
        <Text style={[styles.rowValue, valueTone === 'success' && { color: colors.onSuccess }]}>{value}</Text>
      ) : null)}
      <Ionicons name="chevron-forward" size={18} color={colors.mutedText} style={{ marginLeft: 6 }} />
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: '600', fontFamily: fonts.display, marginBottom: spacing.lg },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.xl,
  },
  quickLogout: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.onError, marginRight: 4 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarPhoto: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceTertiary },
  avatarText: { color: colors.onBrandPrimary, fontSize: 20, fontWeight: '800' },
  name: { color: colors.onSurface, fontSize: 16, fontWeight: '700' },
  role: { color: colors.brandSecondary, fontSize: 12, marginTop: 2 },
  profileHint: { color: colors.mutedText, fontSize: 11, marginTop: 3 },

  groupTitle: {
    color: colors.mutedText, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase',
    fontWeight: '700', marginBottom: spacing.md, marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  rowSub: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
  rowValue: { color: colors.mutedText, fontSize: 13 },

  themeRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md },
  themeOpt: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  themeOptActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  themeOptText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '700' },
  themeOptTextActive: { color: colors.onBrandPrimary },

  logout: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.xl, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error, paddingVertical: 14,
  },
  logoutText: { color: colors.onError, fontWeight: '700', fontSize: 15 },
  footer: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
});
