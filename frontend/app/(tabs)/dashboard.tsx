import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, images, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type DashboardData = {
  todays_attendance: {
    present: number; absent: number; late: number; half_day: number;
    missing_punch: number; leave: number; working: number; total: number;
  };
  pending_approvals: {
    attendance_corrections: number; leave_requests: number;
  };
  repairs_summary: {
    received: number; with_karigar: number; ready: number;
    overdue: number; delivered_today: number; total_open: number;
  };
  tasks_summary: {
    due_today: number; overdue: number; done_today: number; open_total: number;
  };
  business_summary: {
    revenue_today: number; revenue_month: number; intake_today: number;
    active_employees: number; customers_open: number; karigars_open: number;
  };
};

const AUTO_REFRESH_MS = 45000;
const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

function timeAgo(d: Date | null) {
  if (!d) return '';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

export default function DashboardScreen() {
  const { user, hasModule } = useAuth();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, forceTick] = useState(0);

  // Responsive breakpoints: 3-across on phones, more columns as the screen widens.
  const isWide = width >= 900;
  const gridCols = width >= 1100 ? 6 : width >= 820 ? 4 : 3;
  const tileBasis = `${100 / gridCols - 1.5}%`;
  const sectionBasis = isWide ? '48.5%' : '100%';

  const load = useCallback(async (silent?: boolean) => {
    try {
      setError('');
      const res = await api.get<DashboardData>('/dashboard');
      setData(res);
      setLastUpdated(new Date());
    } catch (e: any) {
      if (!silent) setError(e?.detail || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    api.get<{ count: number }>('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => {});
    // Live-refresh: quietly re-pull dashboard numbers while this screen is focused.
    const poll = setInterval(() => load(true), AUTO_REFRESH_MS);
    const clock = setInterval(() => forceTick((t) => t + 1), 15000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [load]));

  const onRefresh = () => { setRefreshing(true); load(); };

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="dashboard-screen">
      <ScrollView
        contentContainerStyle={[styles.scroll, isWide && styles.scrollWide]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.dateText}>{today}</Text>
            <Text style={styles.greeting}>Good day,</Text>
            <Text style={styles.owner} numberOfLines={1}>{user?.name || 'Owner'}</Text>
            {!!lastUpdated && (
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Updated {timeAgo(lastUpdated)}</Text>
              </View>
            )}
          </View>
          <Pressable onPress={() => router.push('/notifications' as any)} style={styles.bellBtn} testID="notifications-btn" hitSlop={12}>
            <Ionicons name="notifications-outline" size={20} color={colors.onSurface} />
            {unread > 0 && <View style={styles.bellDot} />}
          </Pressable>
          <Image source={images.logo} style={styles.headerBadge} contentFit="contain" testID="dashboard-logo" />
        </View>

        {loading && !data ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
          </View>
        ) : error ? (
          <View style={styles.errorCard} testID="dashboard-error">
            <Ionicons name="warning-outline" size={22} color={colors.brandSecondary} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => load()} style={styles.retryBtn} testID="dashboard-retry">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : data ? (
          <>
            {/* Business Snapshot */}
            <SectionHeader title="Business Snapshot" icon="stats-chart-outline" testID="section-business" />
            <View style={[styles.tileGrid, { marginBottom: spacing.xl }]}>
              <StatCard basis={tileBasis} icon="cash-outline" label="Revenue Today" value={fmtINR(data.business_summary.revenue_today)} accent={colors.brandPrimary} testID="biz-revenue-today" onPress={() => router.push('/reports/generate' as any)} />
              <StatCard basis={tileBasis} icon="diamond-outline" label="New Intake Today" value={String(data.business_summary.intake_today)} accent={colors.brandSecondary} testID="biz-intake-today" onPress={() => router.push('/repairs' as any)} />
              <StatCard basis={tileBasis} icon="person-outline" label="Customers with Balance" value={String(data.business_summary.customers_open)} accent={colors.onWarning} testID="biz-customers-open" onPress={() => router.push('/reports/customer-ledger' as any)} />
              <StatCard basis={tileBasis} icon="hammer-outline" label="Karigars with Balance" value={String(data.business_summary.karigars_open)} accent={colors.onWarning} testID="biz-karigars-open" onPress={() => router.push('/reports/karigar-ledger' as any)} />
            </View>

            {/* Today's Attendance */}
            {hasModule('attendance') && (
              <>
                <SectionHeader title="Attendance" icon="time-outline" testID="section-attendance" />
                <Text style={styles.sectionSubtitle}>{data.todays_attendance.working} of {data.todays_attendance.total} employees working now</Text>
                <View style={[styles.tileGrid, { marginBottom: spacing.sm }]}>
                  <StatCard basis={tileBasis} icon="checkmark-circle-outline" label="Present" value={String(data.todays_attendance.present)} accent={colors.brandPrimary} testID="tile-present" onPress={() => router.push('/(tabs)/attendance')} />
                  <StatCard basis={tileBasis} icon="close-circle-outline" label="Absent" value={String(data.todays_attendance.absent)} accent={colors.onError} testID="tile-absent" onPress={() => router.push('/(tabs)/attendance')} />
                  <StatCard basis={tileBasis} icon="alert-circle-outline" label="Missing Punch" value={String(data.todays_attendance.missing_punch)} accent={colors.onError} testID="tile-missing" onPress={() => router.push('/(tabs)/attendance')} />
                </View>

                {hasModule('approvals') && (data.pending_approvals.attendance_corrections > 0 || data.pending_approvals.leave_requests > 0) && (
                  <View style={[styles.approvalRow, { marginBottom: spacing.xl }]}>
                    {data.pending_approvals.attendance_corrections > 0 && (
                      <Pressable style={styles.approvalPill} testID="approval-corrections" onPress={() => router.push('/approvals?tab=Corrections')}>
                        <Ionicons name="time-outline" size={12} color={colors.onWarning} />
                        <Text style={styles.approvalPillText}>{data.pending_approvals.attendance_corrections} correction{data.pending_approvals.attendance_corrections === 1 ? '' : 's'}</Text>
                      </Pressable>
                    )}
                    {data.pending_approvals.leave_requests > 0 && (
                      <Pressable style={styles.approvalPill} testID="approval-leaves" onPress={() => router.push('/approvals?tab=Leaves')}>
                        <Ionicons name="calendar-outline" size={12} color={colors.onWarning} />
                        <Text style={styles.approvalPillText}>{data.pending_approvals.leave_requests} leave request{data.pending_approvals.leave_requests === 1 ? '' : 's'}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </>
            )}

            {/* Responsive section grid: Repairs / Tasks sit side-by-side on wide screens */}
            <View style={styles.sectionGrid}>
              {hasModule('repairs') && (
                <View style={{ flexBasis: sectionBasis, flexGrow: 1 }}>
                  <SectionHeader title="Repairs" icon="construct-outline" testID="section-repairs" />
                  <View style={styles.tileGrid}>
                    <StatCard basis={tileBasis} icon="cube-outline" label="Received · awaiting action" value={String(data.repairs_summary.received)} accent={colors.brandSecondary} testID="repairs-received" onPress={() => router.push('/repairs?filter=received' as any)} />
                    <StatCard basis={tileBasis} icon="hammer-outline" label="With Karigar" value={String(data.repairs_summary.with_karigar)} accent={colors.brandSecondary} testID="repairs-with-karigar" onPress={() => router.push('/repairs?filter=with_karigar' as any)} />
                    <StatCard basis={tileBasis} icon="pricetag-outline" label="Pending to Bill" value={String(data.repairs_summary.ready)} accent={colors.brandSecondary} testID="repairs-ready" onPress={() => router.push('/repairs?filter=ready' as any)} />
                    <StatCard basis={tileBasis} icon="alert-circle-outline" label="Overdue" value={String(data.repairs_summary.overdue)} accent={colors.onError} danger={data.repairs_summary.overdue > 0} testID="repairs-overdue" onPress={() => router.push('/repairs?filter=overdue' as any)} />
                  </View>
                </View>
              )}

              {hasModule('tasks') && (
                <View style={{ flexBasis: sectionBasis, flexGrow: 1 }}>
                  <SectionHeader title="Tasks" icon="checkbox-outline" testID="section-tasks" />
                  <View style={styles.tileGrid}>
                    <StatCard basis={tileBasis} icon="today-outline" label="Due Today" value={String(data.tasks_summary.due_today)} accent={colors.brandSecondary} testID="tasks-due-today" onPress={() => router.push('/tasks' as any)} />
                    <StatCard basis={tileBasis} icon="alert-circle-outline" label="Overdue" value={String(data.tasks_summary.overdue)} accent={colors.onError} danger={data.tasks_summary.overdue > 0} testID="tasks-overdue" onPress={() => router.push('/tasks' as any)} />
                  </View>
                </View>
              )}
            </View>

            <View style={{ height: spacing.xxl }} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title, icon, testID }: { title: string; icon?: any; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.sectionHeader} testID={testID}>
      {!!icon && (
        <View style={styles.sectionIcon}><Ionicons name={icon} size={14} color={colors.brandSecondary} /></View>
      )}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function StatCard({
  icon, label, value, accent, danger, testID, onPress, basis,
}: {
  icon: any; label: string; value: string; accent: string; danger?: boolean;
  testID?: string; onPress?: () => void; basis: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      style={({ pressed }) => [styles.statCard, { flexBasis: basis } as any, danger && styles.statCardDanger, pressed && { opacity: 0.75 }]}
      testID={testID}
      onPress={onPress}
    >
      <View style={[styles.statIconWrap, danger && { backgroundColor: colors.error }]}>
        <Ionicons name={icon} size={16} color={danger ? colors.onError : accent} />
      </View>
      <Text style={[styles.statValue, danger && { color: colors.onError }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  scrollWide: { maxWidth: 1200, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  dateText: { color: colors.brandSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  greeting: { color: colors.onSurfaceTertiary, fontSize: 14, marginTop: spacing.xs },
  owner: {
    color: colors.onSurface, fontSize: 26, fontWeight: '600',
    fontFamily: fonts.display,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onSuccess },
  liveText: { color: colors.mutedText, fontSize: 11 },
  headerBadge: {
    width: 40, height: 40, borderRadius: radius.md,
  },
  bellBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
    marginRight: spacing.sm,
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.error, borderWidth: 1, borderColor: colors.surface,
  },
  loadingWrap: { paddingVertical: 80, alignItems: 'center' },

  sectionSubtitle: { color: colors.mutedText, fontSize: 11, marginBottom: spacing.sm, marginTop: -4 },

  approvalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  approvalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: colors.warning, borderColor: colors.onWarning, borderWidth: 1,
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5,
  },
  approvalPillText: { color: colors.onWarning, fontSize: 11, fontWeight: '700' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm, marginTop: spacing.xs },
  sectionIcon: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: {
    color: colors.onSurface, fontSize: 16, fontWeight: '600',
    fontFamily: fonts.display,
  },

  sectionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  statCard: {
    flexGrow: 1, minWidth: 92,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm,
  },
  statCardDanger: { borderColor: colors.error },
  statIconWrap: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs,
  },
  statValue: { color: colors.onSurface, fontSize: 15, fontWeight: '700', fontFamily: fonts.display },
  statLabel: { color: colors.onSurfaceTertiary, fontSize: 10, marginTop: 1 },

  miniCta: {
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start',
    backgroundColor: colors.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 8,
    marginTop: spacing.sm,
  },
  miniCtaText: { color: colors.onBrandPrimary, fontWeight: '700', fontSize: 12 },

  cta: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.xl,
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
