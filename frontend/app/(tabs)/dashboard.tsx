import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { colors, spacing, radius, images, fonts } from '@/src/theme';

type DashboardData = {
  todays_attendance: {
    present: number; absent: number; late: number; half_day: number;
    missing_punch: number; leave: number; working: number; total: number;
  };
  pending_approvals: {
    attendance_corrections: number; leave_requests: number;
    salary_advances: number; payroll_approval: number;
  };
  payroll_summary: {
    current_month_payroll: number; pending_salary: number;
    advances_outstanding: number; loans_outstanding: number; bonuses: number;
  };
};

const fmtINR = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

export default function DashboardScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await api.get<DashboardData>('/dashboard');
      setData(res);
    } catch (e: any) {
      setError(e?.detail || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateText}>{today}</Text>
            <Text style={styles.greeting}>Good day,</Text>
            <Text style={styles.owner} numberOfLines={1}>{user?.name || 'Owner'}</Text>
          </View>
          <Pressable onPress={() => router.push('/assistant')} style={styles.aiBtn} testID="ai-assistant-btn">
            <Ionicons name="sparkles" size={16} color={colors.onBrandPrimary} />
            <Text style={styles.aiBtnText}>Ask AI</Text>
          </Pressable>
          <Pressable onPress={() => router.push('/')} testID="dashboard-logo-btn" hitSlop={8}>
            <Image source={images.logo} style={styles.headerBadge} contentFit="contain" testID="dashboard-logo" />
          </Pressable>
        </View>

        {loading && !data ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.errorCard} testID="dashboard-error">
            <Ionicons name="warning-outline" size={22} color={colors.brandSecondary} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={load} style={styles.retryBtn} testID="dashboard-retry">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : data ? (
          <>
            {/* Today's Attendance hero */}
            <Pressable
              style={styles.heroCard}
              testID="attendance-hero-card"
              onPress={() => router.push('/(tabs)/attendance')}
            >
              <Image source={images.goldTexture} style={StyleSheet.absoluteFill} contentFit="cover" />
              <LinearGradient
                colors={['rgba(13,13,13,0.65)', 'rgba(13,13,13,0.92)']}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.heroInner}>
                <View style={styles.heroTop}>
                  <View>
                    <Text style={styles.heroLabel}>TODAY&apos;S ATTENDANCE</Text>
                    <Text style={styles.heroTitle}>{data.todays_attendance.working} Working</Text>
                    <Text style={styles.heroSub}>of {data.todays_attendance.total} total employees</Text>
                  </View>
                  <View style={styles.heroChip}>
                    <View style={styles.heroChipDot} />
                    <Text style={styles.heroChipText}>Live</Text>
                  </View>
                </View>

                <View style={styles.attGrid}>
                  <AttTile label="Present" value={data.todays_attendance.present} accent={colors.brandPrimary} testID="tile-present" onPress={() => router.push('/(tabs)/attendance')} />
                  <AttTile label="Absent" value={data.todays_attendance.absent} accent="#F1A9A9" testID="tile-absent" onPress={() => router.push('/(tabs)/attendance')} />
                  <AttTile label="Late" value={data.todays_attendance.late} accent={colors.brandSecondary} testID="tile-late" onPress={() => router.push('/(tabs)/attendance')} />
                  <AttTile label="Half Day" value={data.todays_attendance.half_day} accent="#E9C46A" testID="tile-half-day" onPress={() => router.push('/(tabs)/attendance')} />
                  <AttTile label="Missing Punch" value={data.todays_attendance.missing_punch} accent="#F1A9A9" testID="tile-missing" onPress={() => router.push('/(tabs)/attendance')} />
                  <AttTile label="On Leave" value={data.todays_attendance.leave} accent={colors.onSurfaceTertiary} testID="tile-leave" onPress={() => router.push('/(tabs)/attendance')} />
                </View>
              </View>
            </Pressable>

            {/* Pending Approvals */}
            <SectionHeader title="Pending Approvals" testID="section-approvals" />
            <View style={styles.listCard}>
              <ApprovalRow icon="time-outline" label="Attendance Corrections" count={data.pending_approvals.attendance_corrections} testID="approval-corrections" onPress={() => router.push('/approvals?tab=Corrections')} />
              <Divider />
              <ApprovalRow icon="calendar-outline" label="Leave Requests" count={data.pending_approvals.leave_requests} testID="approval-leaves" onPress={() => router.push('/approvals?tab=Leaves')} />
              <Divider />
              <ApprovalRow icon="cash-outline" label="Salary Advances" count={data.pending_approvals.salary_advances} testID="approval-advances" onPress={() => router.push('/(tabs)/payroll')} />
              <Divider />
              <ApprovalRow icon="document-text-outline" label="Payroll Approval" count={data.pending_approvals.payroll_approval} testID="approval-payroll" onPress={() => router.push('/(tabs)/payroll')} />
            </View>

            {/* Payroll Summary */}
            <SectionHeader title="Payroll Summary" testID="section-payroll" />
            <View style={styles.bento}>
              <PayrollTile label="Current Month Payroll" value={fmtINR(data.payroll_summary.current_month_payroll)} big testID="payroll-current" onPress={() => router.push('/(tabs)/payroll')} />
              <PayrollTile label="Pending Salary" value={fmtINR(data.payroll_summary.pending_salary)} testID="payroll-pending" onPress={() => router.push('/(tabs)/payroll')} />
              <PayrollTile label="Advances" value={fmtINR(data.payroll_summary.advances_outstanding)} testID="payroll-advances" onPress={() => router.push('/(tabs)/payroll')} />
              <PayrollTile label="Loans" value={fmtINR(data.payroll_summary.loans_outstanding)} testID="payroll-loans" onPress={() => router.push('/(tabs)/payroll')} />
              <PayrollTile label="Bonuses" value={fmtINR(data.payroll_summary.bonuses)} testID="payroll-bonuses" onPress={() => router.push('/(tabs)/payroll')} />
            </View>

            <Pressable
              testID="quick-add-employee"
              onPress={() => router.push('/employee/new')}
              style={styles.cta}
            >
              <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
              <Text style={styles.ctaText}>Add Employee</Text>
            </Pressable>

            <View style={{ height: spacing.xxl }} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AttTile({ label, value, accent, testID, onPress }: { label: string; value: number; accent: string; testID?: string; onPress?: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.attTile, pressed && { opacity: 0.7 }]} testID={testID} onPress={onPress}>
      <Text style={[styles.attValue, { color: accent }]}>{value}</Text>
      <Text style={styles.attLabel}>{label}</Text>
    </Pressable>
  );
}

function SectionHeader({ title, testID }: { title: string; testID?: string }) {
  return (
    <View style={styles.sectionHeader} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function ApprovalRow({ icon, label, count, testID, onPress }: { icon: any; label: string; count: number; testID?: string; onPress?: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.appRow, pressed && { opacity: 0.7 }]} testID={testID} onPress={onPress}>
      <View style={styles.appIconWrap}>
        <Ionicons name={icon} size={18} color={colors.brandSecondary} />
      </View>
      <Text style={styles.appLabel}>{label}</Text>
      <View style={[styles.countPill, count === 0 && styles.countPillEmpty]}>
        <Text style={[styles.countPillText, count === 0 && styles.countPillTextEmpty]}>{count}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedText} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

function Divider() { return <View style={styles.divider} />; }

function PayrollTile({ label, value, big, testID, onPress }: { label: string; value: string; big?: boolean; testID?: string; onPress?: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.payrollTile, big && styles.payrollTileBig, pressed && { opacity: 0.75 }]} testID={testID} onPress={onPress}>
      <Text style={styles.payrollLabel}>{label}</Text>
      <Text style={[styles.payrollValue, big && { fontSize: 26 }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  dateText: { color: colors.brandSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  greeting: { color: colors.onSurfaceTertiary, fontSize: 14, marginTop: spacing.xs },
  owner: {
    color: colors.onSurface, fontSize: 26, fontWeight: '600',
    fontFamily: fonts.display,
  },
  headerBadge: {
    width: 40, height: 40, borderRadius: radius.md,
  },
  aiBtn: {
    flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: colors.brandTertiary,
    borderColor: colors.brandPrimary, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, marginRight: spacing.sm,
  },
  aiBtnText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 12 },
  loadingWrap: { paddingVertical: 80, alignItems: 'center' },

  heroCard: {
    borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.borderStrong,
    marginBottom: spacing.xl,
  },
  heroInner: { padding: spacing.lg },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  heroLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  heroTitle: {
    color: colors.onSurface, fontSize: 30, fontWeight: '700', marginTop: 4,
    fontFamily: fonts.display,
  },
  heroSub: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  heroChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(45,90,64,0.35)', borderColor: colors.success, borderWidth: 1,
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5,
  },
  heroChipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8FE0A6' },
  heroChipText: { color: '#B7EFC5', fontSize: 11, fontWeight: '700' },

  attGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  attTile: {
    flexBasis: '31%', flexGrow: 1,
    backgroundColor: 'rgba(38,38,38,0.75)', borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
  },
  attValue: { fontSize: 22, fontWeight: '700', color: colors.brandPrimary },
  attLabel: { color: colors.onSurfaceTertiary, fontSize: 11, marginTop: 2 },

  sectionHeader: { marginBottom: spacing.md, marginTop: spacing.sm },
  sectionTitle: {
    color: colors.onSurface, fontSize: 20, fontWeight: '600',
    fontFamily: fonts.display,
  },
  listCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  appRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md },
  appIconWrap: {
    width: 36, height: 36, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  appLabel: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14 },
  countPill: { minWidth: 30, height: 26, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, backgroundColor: colors.brandPrimary },
  countPillEmpty: { backgroundColor: colors.surfaceTertiary },
  countPillText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 12 },
  countPillTextEmpty: { color: colors.onSurfaceTertiary },
  divider: { height: 1, backgroundColor: colors.divider, marginHorizontal: spacing.lg },

  bento: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  payrollTile: {
    flexBasis: '48%', flexGrow: 1,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.lg,
  },
  payrollTileBig: { flexBasis: '100%', backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary },
  payrollLabel: { color: colors.onSurfaceTertiary, fontSize: 12, letterSpacing: 0.4, marginBottom: spacing.xs },
  payrollValue: { color: colors.onSurface, fontSize: 20, fontWeight: '700' },

  cta: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.md,
  },
  ctaText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },

  errorCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.error, padding: spacing.xl, alignItems: 'center', gap: spacing.md, marginTop: spacing.xl,
  },
  errorText: { color: colors.onError, textAlign: 'center' },
  retryBtn: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
  },
  retryText: { color: colors.onBrandPrimary, fontWeight: '700' },
});
