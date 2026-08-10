import { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { api } from '@/src/api/client';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme, ThemePreference } from '@/src/theme/ThemeContext';
import { isPushSupported, isSubscribed, subscribeToPush, unsubscribeFromPush } from '@/src/utils/push';

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
    try { const res = await api.get<any>(`/employees/${user.id}`); setDetails(res.employee); }
    catch (_e) { setDetails(null); }
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    load();
    if (isPushSupported()) isSubscribed().then(setPushOn);
  }, [load]));

  const togglePush = async () => {
    if (!isPushSupported()) {
      Alert.alert('Not supported', 'Notifications aren’t supported in this browser.');
      return;
    }
    setPushBusy(true);
    try {
      if (pushOn) {
        await unsubscribeFromPush();
        setPushOn(false);
      } else {
        const res = await subscribeToPush();
        if (res.ok) setPushOn(true);
        else Alert.alert('Couldn’t enable notifications', res.reason || 'Please try again');
      }
    } finally {
      setPushBusy(false);
    }
  };

  const onLogout = async () => { await logout(); router.replace('/login'); };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-profile-screen">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.card}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || 'E')[0]?.toUpperCase()}</Text></View>
          <Text style={styles.name}>{user?.name}</Text>
          <Text style={styles.subtitle}>{user?.employee_code} · {user?.designation || '—'}</Text>
          <Text style={styles.dept}>{user?.department || '—'}</Text>
        </View>

        {details && (
          <>
            <SectionLabel text="Job" />
            <View style={styles.list}>
              <Row label="Shift" value={details.shift || '—'} />
              <Divider />
              <Row label="Joined" value={details.joining_date || '—'} />
              <Divider />
              <Row label="Salary" value={`₹${(details.salary || 0).toLocaleString('en-IN')}`} />
            </View>

            <SectionLabel text="Contact" />
            <View style={styles.list}>
              <Row label="Mobile" value={details.mobile || '—'} />
              <Divider />
              <Row label="Address" value={details.address || '—'} />
            </View>

            <SectionLabel text="Bank" />
            <View style={styles.list}>
              <Row label="Bank" value={details.bank_name || '—'} />
              <Divider />
              <Row label="Account" value={details.bank_account || '—'} />
              <Divider />
              <Row label="IFSC" value={details.bank_ifsc || '—'} />
            </View>

            {!!(details.id_proofs && details.id_proofs.length) && (
              <>
                <SectionLabel text="ID Proofs" />
                <View style={styles.list}>
                  {details.id_proofs.map((p: any, i: number) => (
                    <View key={p.id}>
                      {i > 0 && <Divider />}
                      <Pressable
                        style={styles.proofRow}
                        onPress={() => { if (Platform.OS === 'web' && typeof window !== 'undefined') window.open(p.data_uri, '_blank'); }}
                        testID={`emp-id-proof-${p.id}`}
                      >
                        <Ionicons name="document-attach-outline" size={16} color={colors.brandSecondary} />
                        <Text style={styles.proofName} numberOfLines={1}>{p.name}</Text>
                        <Ionicons name="open-outline" size={14} color={colors.mutedText} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        <SectionLabel text="Preferences" />
        <View style={styles.list}>
          <Pressable testID="emp-notifications-toggle" onPress={togglePush} disabled={pushBusy}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Notifications</Text>
              {pushBusy ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : (
                <Text style={[styles.rowValue, pushOn && { color: colors.onSuccess }]}>{pushOn ? 'On' : 'Off'}</Text>
              )}
            </View>
          </Pressable>
          <Divider />
          <Pressable testID="emp-appearance-btn" onPress={() => setThemePickerOpen((v) => !v)}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Appearance</Text>
              <Text style={styles.rowValue}>{THEME_LABEL[preference]}</Text>
            </View>
          </Pressable>
        </View>
        {themePickerOpen && (
          <View style={styles.themeRow} testID="emp-appearance-options">
            {(['system', 'light', 'dark'] as const).map((opt) => (
              <Pressable
                key={opt} testID={`emp-appearance-${opt}`}
                onPress={() => { setPreference(opt); setThemePickerOpen(false); }}
                style={[styles.themeOpt, preference === opt && styles.themeOptActive]}
              >
                <Text style={[styles.themeOptText, preference === opt && styles.themeOptTextActive]}>{THEME_LABEL[opt]}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <Pressable testID="emp-logout-btn-profile" style={styles.logoutBtn} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color={colors.onError} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ text }: { text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Text style={styles.sectionLabel}>{text}</Text>;
}
function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}
function Divider() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.divider} />;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: {
    color: colors.onSurface, fontSize: 26, fontWeight: '600', marginBottom: spacing.lg,
    fontFamily: fonts.display,
  },
  card: {
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg, borderColor: colors.brandPrimary,
    borderWidth: 1, padding: spacing.xl, alignItems: 'center',
  },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 28 },
  name: {
    color: colors.onSurface, fontSize: 20, fontWeight: '700', marginTop: spacing.md,
    fontFamily: fonts.display,
  },
  subtitle: { color: colors.brandSecondary, fontSize: 13, marginTop: 4 },
  dept: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },

  sectionLabel: {
    color: colors.mutedText, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.xl, marginBottom: spacing.sm,
  },
  list: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, overflow: 'hidden',
  },
  row: { flexDirection: 'row', paddingVertical: 12, paddingHorizontal: spacing.lg, gap: spacing.md },
  rowLabel: { color: colors.mutedText, fontSize: 13, width: 90 },
  rowValue: { color: colors.onSurface, fontSize: 13, flex: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.lg },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.lg },
  proofName: { flex: 1, color: colors.onSurface, fontSize: 13 },

  themeRow: {
    flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm,
  },
  themeOpt: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
  },
  themeOptActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  themeOptText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: '700' },
  themeOptTextActive: { color: colors.onBrandPrimary },

  logoutBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderColor: colors.error, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.xl,
  },
  logoutText: { color: colors.onError, fontWeight: '700' },
});
