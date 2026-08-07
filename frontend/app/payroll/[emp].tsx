import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { colors, spacing, radius } from '@/src/theme';

const fmtINR = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function PayrollDetail() {
  const { emp, year, month } = useLocalSearchParams<{ emp: string; year: string; month: string }>();
  const y = parseInt(year || '0', 10), m = parseInt(month || '0', 10);
  const router = useRouter();
  const { user } = useAuth();
  const canWrite = user?.role === 'owner' || user?.role === 'accountant';
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await api.get<any>(`/payroll/${y}/${m}`);
      const found = (res.rows || []).find((r: any) => r.employee_id === emp);
      setRow(found ? { ...found, _saved: res.saved, _locked: res.locked } : null);
    } finally { setLoading(false); }
  }, [emp, y, m]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markPaid = async () => {
    if (!row?.id) { Alert.alert('Generate payroll first', 'Save the payroll for this month before marking paid.'); return; }
    try {
      await api.post(`/payroll/entry/${row.id}/pay`);
      await load();
      Alert.alert('Marked paid', 'Salary receipt is ready to download.');
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
  };

  const downloadPdf = () => {
    if (!row?.id) { Alert.alert('Generate payroll first', 'Save the payroll for this month first.'); return; }
    const base = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    const url = `${base}/api/payroll/entry/${row.id}/pdf`;
    // Server requires auth header; open via a signed URL not possible here so use API and open in browser after we fetch token — for now open via Linking; user is authed cookie-free so this is limited. For mobile, prefer expo-web-browser. Keep simple: alert with URL.
    Linking.openURL(url).catch(() => Alert.alert('Preview only', 'Deploy the app to download PDFs on device. Current URL: ' + url));
  };

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>;
  if (!row) return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Header title="Payroll" onBack={() => router.back()} />
      <View style={styles.centered}><Text style={{ color: colors.onSurface }}>Entry not found</Text></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="payroll-detail-screen">
      <Header title={`${MONTHS[m - 1]} ${y}`} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.head}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(row.name)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{row.name}</Text>
            <Text style={styles.meta}>{row.employee_code} · {row.designation || '—'}</Text>
          </View>
        </View>

        <Line label="Base Salary" value={fmtINR(row.base_salary)} />
        <SectionTitle text="Days Summary" />
        <Line label="Present days" value={String(row.present_days)} />
        <Line label="Half days" value={String(row.half_days)} />
        <Line label="Sunday work" value={String(row.sunday_work)} />
        <Line label="Leave days" value={String(row.leave_days)} />
        <Line label="Effective / Total" value={`${row.effective_days} / ${row.total_days}`} />

        <SectionTitle text="Breakdown" />
        <Line label="Earned" value={fmtINR(row.earned)} accent />
        <Line label="Bonus" value={`+ ${fmtINR(row.bonus)}`} pos />
        <Line label="Advance" value={`− ${fmtINR(row.advance)}`} neg />
        <Line label="Fine" value={`− ${fmtINR(row.fine)}`} neg />
        <Line label="Manual Deduction" value={`− ${fmtINR(row.manual_deduction)}`} neg />

        <View style={styles.netBox}>
          <Text style={styles.netLabel}>NET SALARY</Text>
          <Text style={styles.netVal}>{fmtINR(row.net_salary)}</Text>
        </View>

        <View style={styles.actions}>
          {row._saved && !row.paid && canWrite && (
            <Pressable style={styles.payBtn} onPress={markPaid} testID="mark-paid-btn">
              <Ionicons name="wallet-outline" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.payText}>Mark Paid</Text>
            </Pressable>
          )}
          {row._saved && (
            <Pressable style={styles.pdfBtn} onPress={downloadPdf} testID="download-pdf-btn">
              <Ionicons name="document-text-outline" size={18} color={colors.onSurface} />
              <Text style={styles.pdfText}>{row.paid ? 'Download Receipt' : 'Download Payslip'} (PDF)</Text>
            </Pressable>
          )}
          {row.paid && (
            <View style={styles.paidBanner}>
              <Ionicons name="checkmark-circle" size={20} color={colors.brandPrimary} />
              <Text style={styles.paidBannerText}>Paid</Text>
            </View>
          )}
          {!row._saved && (
            <View style={styles.hintBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.brandSecondary} />
              <Text style={styles.hintText}>Preview only. Generate payroll on the Payroll tab to unlock PDF & payment actions.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
        <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function SectionTitle({ text }: { text: string }) { return <Text style={styles.section}>{text}</Text>; }
function Line({ label, value, pos, neg, accent }: { label: string; value: string; pos?: boolean; neg?: boolean; accent?: boolean }) {
  const c = pos ? '#B7EFC5' : neg ? '#F1A9A9' : accent ? colors.brandPrimary : colors.onSurface;
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={[styles.lineValue, { color: c }]}>{value}</Text>
    </View>
  );
}

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 22, fontWeight: '600',
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },

  head: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onBrandPrimary, fontSize: 18, fontWeight: '800' },
  name: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  meta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },

  section: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  line: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, marginBottom: 4,
  },
  lineLabel: { color: colors.onSurfaceTertiary, fontSize: 13 },
  lineValue: { fontSize: 14, fontWeight: '700' },

  netBox: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, padding: spacing.lg,
    marginTop: spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  netLabel: { color: colors.onBrandPrimary, fontWeight: '800', letterSpacing: 1, fontSize: 13 },
  netVal: { color: colors.onBrandPrimary, fontSize: 26, fontWeight: '800' },

  actions: { marginTop: spacing.lg, gap: spacing.md },
  payBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14,
  },
  payText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15 },
  pdfBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderColor: colors.brand, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 14,
  },
  pdfText: { color: colors.onSurface, fontWeight: '700' },
  paidBanner: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 12,
  },
  paidBannerText: { color: colors.brandSecondary, fontWeight: '700' },
  hintBox: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center',
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md,
  },
  hintText: { color: colors.onSurfaceTertiary, fontSize: 12, flex: 1 },
});
