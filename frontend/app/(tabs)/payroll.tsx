import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Row = {
  employee_id: string; employee_code: string; name: string; designation: string; department: string;
  base_salary: number; present_days: number; half_days: number; sunday_work: number;
  leave_days: number; total_days: number; effective_days: number;
  earned: number; advance: number; bonus: number; fine: number; manual_deduction: number;
  net_salary: number; paid?: boolean; id?: string; photo?: string;
};
type PayrollResp = { year: number; month: number; rows: Row[]; saved?: boolean; locked?: boolean; total_net: number };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtINR = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

export default function OwnerPayroll() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const goBack = () => { if (from === 'transactions') router.replace('/(tabs)/transactions' as any); else router.back(); };
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user } = useAuth();
  const isAccountantOrOwner = user?.role === 'owner' || user?.role === 'accountant';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<PayrollResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<PayrollResp>(`/payroll/${year}/${month}`);
      setData(res);
    } catch (_e) {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const stepMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m); setYear(y);
  };

  const savePayroll = async (isRegenerate = false) => {
    if (submittingRef.current) return; // block rapid double/triple taps
    submittingRef.current = true;
    setSaving(true);
    try {
      const res = await api.post<{ entries: number; kept_paid: number }>('/payroll/save', { year, month });
      await load();
      if (isRegenerate) {
        Alert.alert(
          'Regenerated',
          `Refreshed ${res.entries} employee${res.entries === 1 ? '' : 's'} from the latest attendance.` +
          (res.kept_paid ? ` ${res.kept_paid} already-paid entr${res.kept_paid === 1 ? 'y was' : 'ies were'} left untouched.` : ''),
        );
      } else {
        Alert.alert('Saved', 'Payroll generated. You can now mark employees paid or lock the month.');
      }
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const toggleLock = async () => {
    if (submittingRef.current) return;
    if (!data?.saved) { Alert.alert('Save first', 'Generate payroll before locking'); return; }
    submittingRef.current = true;
    try {
      if (data.locked) await api.post(`/payroll/${year}/${month}/unlock`);
      else await api.post(`/payroll/${year}/${month}/lock`);
      await load();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { submittingRef.current = false; }
  };

  const totalPaid = useMemo(() => (data?.rows || []).filter((r) => r.paid).reduce((a, r) => a + r.net_salary, 0), [data]);
  const totalPending = (data?.total_net || 0) - totalPaid;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="payroll-screen">
      <View style={styles.header}>
        {(router.canGoBack() || from === 'transactions') && (
          <Pressable onPress={goBack} style={styles.backBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
        )}
        <Text style={styles.title}>Payroll</Text>
        {data?.locked ? (
          <View style={styles.lockedChip}><Ionicons name="lock-closed" size={12} color={colors.onWarning} /><Text style={styles.lockedText}>Locked</Text></View>
        ) : null}
      </View>

      {/* Month picker */}
      <View style={styles.monthRow}>
        <Pressable onPress={() => stepMonth(-1)} style={styles.monthNav} testID="month-prev"><Ionicons name="chevron-back" size={20} color={colors.onSurface} /></Pressable>
        <View style={styles.monthLabel}>
          <Text style={styles.monthText}>{MONTHS[month - 1]} {year}</Text>
        </View>
        <Pressable onPress={() => stepMonth(1)} style={styles.monthNav} testID="month-next"><Ionicons name="chevron-forward" size={20} color={colors.onSurface} /></Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} size="large" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.brandPrimary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Summary */}
          <View style={styles.summary} testID="payroll-summary">
            <View style={styles.summaryTile}>
              <Text style={styles.summaryLabel}>Total Payroll</Text>
              <Text style={styles.summaryValue}>{fmtINR(data?.total_net || 0)}</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryLabel}>Paid</Text>
              <Text style={[styles.summaryValue, { color: colors.brandSecondary }]}>{fmtINR(totalPaid)}</Text>
            </View>
            <View style={styles.summaryTile}>
              <Text style={styles.summaryLabel}>Pending</Text>
              <Text style={[styles.summaryValue, { color: colors.onWarning }]}>{fmtINR(totalPending)}</Text>
            </View>
          </View>

          {/* Actions row */}
          {isAccountantOrOwner && (
            <View style={styles.actionsRow}>
              {!data?.saved ? (
                <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={() => savePayroll(false)} disabled={saving} testID="payroll-save-btn">
                  {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <><Ionicons name="save-outline" size={16} color={colors.onBrandPrimary} /><Text style={styles.saveText}>Generate Payroll</Text></>}
                </Pressable>
              ) : !data.locked ? (
                <>
                  <Pressable style={[styles.regenBtn, saving && { opacity: 0.6 }]} onPress={() => savePayroll(true)} disabled={saving} testID="payroll-regenerate-btn">
                    {saving ? <ActivityIndicator color={colors.onSurface} /> : <><Ionicons name="refresh-outline" size={16} color={colors.onSurface} /><Text style={styles.lockBtnText}>Regenerate</Text></>}
                  </Pressable>
                  <Pressable style={styles.lockBtn} onPress={toggleLock} testID="payroll-lock-btn">
                    <Ionicons name="lock-closed-outline" size={16} color={colors.onSurface} />
                    <Text style={styles.lockBtnText}>Lock Month</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable style={styles.lockBtn} onPress={toggleLock} testID="payroll-lock-btn">
                  <Ionicons name="lock-open-outline" size={16} color={colors.onSurface} />
                  <Text style={styles.lockBtnText}>Unlock</Text>
                </Pressable>
              )}
            </View>
          )}
          {data?.saved && !data.locked && (
            <Text style={styles.regenHint}>Adjusted attendance for someone this month? Tap Regenerate to refresh unpaid entries — paid ones stay untouched.</Text>
          )}

          {/* Employee rows */}
          {(data?.rows || []).map((r) => (
            <Pressable
              key={r.employee_id}
              testID={`payroll-row-${r.employee_id}`}
              onPress={() => router.push({
                pathname: '/payroll/[emp]',
                params: { emp: r.employee_id, year: String(year), month: String(month) },
              })}
              style={[styles.empRow, r.paid && styles.empRowPaid]}
            >
              {r.photo ? (
                <Image source={{ uri: r.photo }} style={styles.avatarPhoto} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarText}>{initials(r.name)}</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.empName} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.empSub}>
                  {r.present_days}P · {r.half_days}HD · {r.sunday_work}Su · {r.leave_days}L
                </Text>
                {(r.advance > 0 || r.bonus > 0 || r.fine > 0 || r.manual_deduction > 0) && (
                  <Text style={styles.empExtras}>
                    {r.bonus > 0 && `+${fmtINR(r.bonus)} bonus `}
                    {r.advance > 0 && `-${fmtINR(r.advance)} adv `}
                    {r.fine > 0 && `-${fmtINR(r.fine)} fine `}
                    {r.manual_deduction > 0 && `-${fmtINR(r.manual_deduction)} ded`}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.netVal}>{fmtINR(r.net_salary)}</Text>
                {r.paid ? (
                  <View style={styles.paidChip}><Text style={styles.paidText}>PAID</Text></View>
                ) : data?.saved ? (
                  <Text style={styles.pendingText}>Pending</Text>
                ) : null}
              </View>
            </Pressable>
          ))}

          {(!data?.rows || data.rows.length === 0) && (
            <View style={styles.emptyBox}>
              <Ionicons name="cash-outline" size={44} color={colors.mutedText} />
              <Text style={styles.emptyText}>No payroll data for this month</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md, gap: spacing.md,
  },
  title: {
    flex: 1, color: colors.onSurface, fontSize: 30, fontWeight: '600',
    fontFamily: fonts.display,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  lockedChip: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    backgroundColor: colors.warning, borderColor: colors.onWarning, borderWidth: 1,
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  lockedText: { color: colors.onWarning, fontWeight: '700', fontSize: 11 },

  monthRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 6,
  },
  monthNav: {
    width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  monthLabel: { flex: 1, alignItems: 'center' },
  monthText: { color: colors.onSurface, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },

  summary: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.md },
  summaryTile: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md,
  },
  summaryLabel: { color: colors.mutedText, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  summaryValue: { color: colors.onSurface, fontSize: 16, fontWeight: '700', marginTop: 4 },

  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  saveBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 12,
  },
  saveText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 13 },
  lockBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderColor: colors.brand, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 12,
  },
  regenBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 12,
  },
  regenHint: { color: colors.mutedText, fontSize: 11, marginBottom: spacing.md, marginTop: -4 },
  lockBtnText: { color: colors.onSurface, fontWeight: '700', fontSize: 13 },

  empRow: {
    flexDirection: 'row', gap: spacing.md, alignItems: 'center',
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  empRowPaid: { backgroundColor: colors.success, borderColor: colors.onSuccess },
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  avatarText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13 },
  avatarPhoto: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary },
  empName: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  empSub: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },
  empExtras: { color: colors.mutedText, fontSize: 10, marginTop: 2 },
  netVal: { color: colors.brandPrimary, fontSize: 16, fontWeight: '800' },
  paidChip: {
    marginTop: 4, backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary,
    borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2,
  },
  paidText: { color: colors.brandSecondary, fontSize: 9, fontWeight: '800' },
  pendingText: { color: colors.mutedText, fontSize: 10, marginTop: 4 },

  emptyBox: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
