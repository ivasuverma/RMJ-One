import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { api } from '@/src/api/client';
import { colors, spacing, radius } from '@/src/theme';

export default function EmployeeProfile() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [details, setDetails] = useState<any>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    try { const res = await api.get<any>(`/employees/${user.id}`); setDetails(res.employee); }
    catch (_e) { setDetails(null); }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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
          </>
        )}

        <Pressable testID="emp-logout-btn-profile" style={styles.logoutBtn} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={20} color="#F1A9A9" />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}
function Divider() { return <View style={styles.divider} />; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  title: {
    color: colors.onSurface, fontSize: 26, fontWeight: '600', marginBottom: spacing.lg,
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
  card: {
    backgroundColor: colors.brandTertiary, borderRadius: radius.lg, borderColor: colors.brandPrimary,
    borderWidth: 1, padding: spacing.xl, alignItems: 'center',
  },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 28 },
  name: {
    color: colors.onSurface, fontSize: 20, fontWeight: '700', marginTop: spacing.md,
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
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

  logoutBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderColor: colors.error, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.xl,
  },
  logoutText: { color: '#F1A9A9', fontWeight: '700' },
});
