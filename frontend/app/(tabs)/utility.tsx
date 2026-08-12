import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme, ThemePreference } from '@/src/theme/ThemeContext';
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '@/src/utils/push';

type TileDef = {
  key: string; label: string; icon: keyof typeof Ionicons.glyphMap;
  route?: string; comingSoon?: boolean; ownerOnly?: boolean;
};

const SECTIONS: { title: string; tiles: TileDef[] }[] = [
  {
    title: 'Universal',
    tiles: [
      { key: 'store', label: 'Store Settings', icon: 'storefront-outline', route: '/store-settings', ownerOnly: true },
      { key: 'user-roles', label: 'User Roles', icon: 'shield-outline', route: '/settings/user-roles', ownerOnly: true },
      { key: 'staff', label: 'Staff Accounts', icon: 'people-circle-outline', route: '/settings/users', ownerOnly: true },
    ],
  },
  {
    title: 'Employee Management',
    tiles: [
      { key: 'biometric', label: 'Biometric Devices', icon: 'hardware-chip-outline', route: '/settings/biometric', ownerOnly: true },
    ],
  },
  {
    title: 'Repairs',
    tiles: [
      { key: 'repair-types', label: 'Repair Types', icon: 'construct-outline', comingSoon: true },
    ],
  },
];

const THEME_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export default function UtilityScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isOwner = user?.role === 'owner';
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  useFocusEffect(useCallback(() => {
    if (isPushSupported()) isSubscribed().then(setPushOn);
  }, []));

  const togglePush = async () => {
    if (!isPushSupported()) { Alert.alert('Not supported', 'Notifications aren’t supported in this browser.'); return; }
    setPushBusy(true);
    try {
      if (pushOn) { await unsubscribeFromPush(); setPushOn(false); }
      else {
        const res = await subscribeToPush();
        if (res.ok) setPushOn(true);
        else Alert.alert('Couldn’t enable notifications', res.reason || 'Please try again');
      }
    } finally { setPushBusy(false); }
  };

  const onLogout = async () => { await logout(); router.replace('/login'); };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="utility-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Utility</Text>
        <Text style={styles.subtitle}>Settings and tools that apply across the whole business.</Text>

        <Pressable testID="utility-account-card" onPress={() => router.push('/settings/account' as any)} style={styles.profileCard}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || 'O')[0]?.toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.role}>{(user?.role || '').charAt(0).toUpperCase() + (user?.role || '').slice(1)} · @{user?.username}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        {SECTIONS.filter((s) => s.tiles.some((t) => !t.ownerOnly || isOwner)).map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.tiles.filter((t) => !t.ownerOnly || isOwner).map((t) => (
                <Pressable
                  key={t.key}
                  testID={`utility-tile-${t.key}`}
                  disabled={t.comingSoon}
                  onPress={() => t.route && router.push(t.route as any)}
                  style={({ pressed }) => [styles.tile, t.comingSoon && styles.tileDisabled, pressed && !t.comingSoon && { opacity: 0.8 }]}
                >
                  <View style={[styles.tileIcon, t.comingSoon && styles.tileIconDisabled]}>
                    <Ionicons name={t.icon} size={24} color={t.comingSoon ? colors.mutedText : colors.brandPrimary} />
                  </View>
                  <Text style={[styles.tileLabel, t.comingSoon && styles.tileLabelDisabled]}>{t.label}</Text>
                  {t.comingSoon && <Text style={styles.soon}>Soon</Text>}
                </Pressable>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.sectionLabel}>Preferences</Text>
        <View style={styles.card}>
          <Pressable testID="utility-notifications-toggle" onPress={togglePush} disabled={pushBusy}>
            <View style={styles.row}>
              <View style={styles.rowIcon}><Ionicons name="notifications-outline" size={18} color={colors.brandSecondary} /></View>
              <Text style={styles.rowLabel}>Notifications</Text>
              {pushBusy ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : (
                <Text style={[styles.rowTrail, pushOn && { color: colors.onSuccess }]}>{pushOn ? 'On' : 'Off'}</Text>
              )}
            </View>
          </Pressable>
          <Divider />
          <Pressable testID="utility-appearance-btn" onPress={() => setThemePickerOpen((v) => !v)}>
            <View style={styles.row}>
              <View style={styles.rowIcon}><Ionicons name="moon-outline" size={18} color={colors.brandSecondary} /></View>
              <Text style={styles.rowLabel}>Appearance</Text>
              <Text style={styles.rowTrail}>{THEME_LABEL[preference]}</Text>
            </View>
          </Pressable>
          {themePickerOpen && (
            <View style={styles.themeRow} testID="utility-appearance-options">
              {(['system', 'light', 'dark'] as const).map((opt) => (
                <Pressable key={opt} testID={`appearance-${opt}`} onPress={() => { setPreference(opt); setThemePickerOpen(false); }} style={[styles.themeOpt, preference === opt && styles.themeOptActive]}>
                  <Text style={[styles.themeOptText, preference === opt && styles.themeOptTextActive]}>{THEME_LABEL[opt]}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <Pressable testID="logout-btn" style={styles.logout} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.onError} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>

        <Text style={styles.footer}>RMJ-One · One system for the entire business</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.lg }} />;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: '600', fontFamily: fonts.display, marginBottom: 4 },
  subtitle: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.lg },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.brandPrimary, padding: spacing.lg, marginBottom: spacing.lg,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.onBrandPrimary, fontSize: 18, fontWeight: '800' },
  name: { color: colors.onSurface, fontSize: 15, fontWeight: '700' },
  role: { color: colors.brandSecondary, fontSize: 12, marginTop: 2 },

  sectionLabel: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginBottom: spacing.md, marginTop: spacing.lg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '30%', flexGrow: 1, minWidth: 96,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  tileDisabled: { opacity: 0.55 },
  tileIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.brand,
  },
  tileIconDisabled: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  tileLabel: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  tileLabelDisabled: { color: colors.onSurfaceTertiary },
  soon: { color: colors.mutedText, fontSize: 10, marginTop: 2 },

  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: spacing.lg, gap: spacing.md },
  rowIcon: { width: 32, height: 32, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },
  rowTrail: { color: colors.mutedText, fontSize: 13 },

  themeRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surfaceTertiary },
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
