import { ReactNode, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme, ThemePreference } from '@/src/theme/ThemeContext';
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '@/src/utils/push';

// Settings, rethought (v2 Phase 6): grouped iOS-style inset list — a profile
// card at the top, then quiet section headers over full-width rows (icon +
// label + optional value + chevron). Config + identity only; the party
// directories (customers/karigars) are NOT here anymore — they live in Work >
// Ledger. Rows use Ionicons rather than SF Symbols because RMJ-One ships as a
// web export, where expo-symbols would render blank.
const THEME_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

type RowDef = {
  key: string; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; route: string;
};
type GroupDef = { title: string; ownerOnly?: boolean; rows: RowDef[] };

// Masters (Account Types drives the Ledger filters — Phase 5), Business, and
// People/Access. Directories intentionally excluded except the team roster.
const GROUPS: GroupDef[] = [
  {
    title: 'People & Access', ownerOnly: true,
    rows: [
      { key: 'user-roles', label: 'Users & Roles', sub: 'Who can access what', icon: 'shield-checkmark-outline', route: '/settings/user-roles' },
      { key: 'staff', label: 'Staff Accounts', sub: 'Admin & accountant logins', icon: 'people-circle-outline', route: '/settings/users' },
      { key: 'team', label: 'Team Roster', sub: 'Your employees', icon: 'people-outline', route: '/(tabs)/employees' },
    ],
  },
  {
    title: 'Masters', ownerOnly: true,
    rows: [
      { key: 'account-types', label: 'Account Types', sub: 'Ledger categories', icon: 'pricetags-outline', route: '/settings/account-types' },
      { key: 'repair-types', label: 'Repair Types', sub: 'Repair catalogue', icon: 'construct-outline', route: '/settings/repair-types' },
      { key: 'item-master', label: 'Items & Purity', sub: 'Item master & purity', icon: 'diamond-outline', route: '/settings/item-master' },
      { key: 'shifts', label: 'Shifts', sub: 'Work timings', icon: 'time-outline', route: '/settings/shifts' },
      { key: 'holidays', label: 'Holidays', sub: 'Holiday calendar', icon: 'calendar-outline', route: '/settings/holidays' },
    ],
  },
  {
    title: 'Business', ownerOnly: true,
    rows: [
      { key: 'store', label: 'Store Settings', sub: 'Shop profile & hours', icon: 'storefront-outline', route: '/store-settings' },
      { key: 'biometric', label: 'Biometric Devices', sub: 'Attendance hardware', icon: 'hardware-chip-outline', route: '/settings/biometric' },
      { key: 'audit', label: 'Audit Log', sub: 'Every change, logged', icon: 'document-lock-outline', route: '/settings/audit' },
    ],
  },
];

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

  const visibleGroups = GROUPS.filter((g) => !g.ownerOnly || isOwner);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="utility-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Settings</Text>

        {/* Apple-ID-style profile card */}
        <Pressable testID="utility-account-card" onPress={() => router.push('/settings/account' as any)} style={({ pressed }) => [styles.profileCard, pressed && { opacity: 0.85 }]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || 'O')[0]?.toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.role}>{(user?.role || '').charAt(0).toUpperCase() + (user?.role || '').slice(1)} · @{user?.username}</Text>
            <Text style={styles.profileHint}>Account, password & sign-in</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedText} />
        </Pressable>

        {visibleGroups.map((g) => (
          <View key={g.title}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            {g.rows.map((r) => (
              <Row
                key={r.key}
                icon={r.icon}
                label={r.label}
                sub={r.sub}
                onPress={() => router.push(r.route as any)}
                testID={`settings-row-${r.key}`}
              />
            ))}
          </View>
        ))}

        {/* App preferences */}
        <Text style={styles.groupTitle}>App</Text>
        <Row
          icon="notifications-outline"
          label="Notifications"
          sub="Push alerts on this device"
          value={pushBusy ? undefined : (pushOn ? 'On' : 'Off')}
          valueTone={pushOn ? 'success' : undefined}
          trailing={pushBusy ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : undefined}
          onPress={togglePush}
          testID="utility-notifications-toggle"
        />
        {isOwner && (
          <Row
            icon="options-outline"
            label="Notification Settings"
            sub="What triggers an alert"
            onPress={() => router.push('/settings/notifications' as any)}
            testID="settings-row-notifications"
          />
        )}
        <Row
          icon="contrast-outline"
          label="Appearance"
          sub="Light, dark or system"
          value={THEME_LABEL[preference]}
          onPress={() => setThemePickerOpen((v) => !v)}
          testID="utility-appearance-btn"
        />
        {themePickerOpen && (
          <View style={styles.themeRow} testID="utility-appearance-options">
            {(['system', 'light', 'dark'] as const).map((opt) => (
              <Pressable key={opt} testID={`appearance-${opt}`} onPress={() => { setPreference(opt); setThemePickerOpen(false); }} style={[styles.themeOpt, preference === opt && styles.themeOptActive]}>
                <Text style={[styles.themeOptText, preference === opt && styles.themeOptTextActive]}>{THEME_LABEL[opt]}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable testID="logout-btn" style={styles.logout} onPress={onLogout}>
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
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
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

  themeRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.surfaceTertiary },
  themeOpt: { flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  themeOptActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  themeOptText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '700' },
  themeOptTextActive: { color: colors.onBrandPrimary },

  logout: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    marginTop: spacing.sm, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.error, paddingVertical: 14,
  },
  logoutText: { color: colors.onError, fontWeight: '700', fontSize: 15 },
  footer: { color: colors.mutedText, fontSize: 11, textAlign: 'center', marginTop: spacing.xl },
});
