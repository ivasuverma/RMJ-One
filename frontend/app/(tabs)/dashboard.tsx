import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { nowISTLongLabel } from '@/src/utils/datetime';
import { spacing, radius, images, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Screen, Section, StatTile, Skeleton, ErrorState, Badge } from '@/src/components/ui';

type DashboardData = {
  todays_attendance: {
    present: number; absent: number; late: number; half_day: number;
    missing_punch: number; not_checked_in: number; leave: number; working: number; total: number;
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
  samples_summary: {
    with_karigar: number; overdue: number; received_today: number;
  };
  cashbook_summary: {
    received_today: number; paid_today: number; closing_balance: number;
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

  const today = nowISTLongLabel();

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={isWide ? styles.scrollWide : undefined}
      testID="dashboard-screen"
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
        {/* Settings is a tab now, but also reachable via this gear (v2 IA). */}
        <Pressable onPress={() => router.push('/(tabs)/utility' as any)} style={styles.bellBtn} testID="dashboard-settings-btn" hitSlop={12}>
          <Ionicons name="settings-outline" size={20} color={colors.onSurface} />
        </Pressable>
        <Image source={images.logo} style={styles.headerBadge} contentFit="contain" testID="dashboard-logo" />
      </View>

      {loading && !data ? (
        <DashboardSkeleton />
      ) : error ? (
        <ErrorState message={error} onRetry={() => load()} testID="dashboard-error" />
      ) : data ? (
        <>
          {/* Today's Attendance */}
          {hasModule('attendance') && (
            <Section title="Attendance" icon="time-outline" testID="section-attendance"
              subtitle={`${data.todays_attendance.working} of ${data.todays_attendance.total} employees working now`}
            >
              <View style={[styles.tileGrid, { marginBottom: spacing.sm }]}>
                <StatTile basis={tileBasis} icon="checkmark-circle-outline" label="Present" value={String(data.todays_attendance.present)} tone="success" testID="tile-present" onPress={() => router.push('/(tabs)/attendance?filter=present' as any)} />
                <StatTile basis={tileBasis} icon="alarm-outline" label="Late" value={String(data.todays_attendance.late)} tone="warning" testID="tile-late" onPress={() => router.push('/(tabs)/attendance?filter=late' as any)} />
                <StatTile basis={tileBasis} icon="time-outline" label="Half Day" value={String(data.todays_attendance.half_day)} tone="info" testID="tile-half-day" onPress={() => router.push('/(tabs)/attendance?filter=half_day' as any)} />
                <StatTile basis={tileBasis} icon="hourglass-outline" label="Not Checked In" value={String(data.todays_attendance.not_checked_in)} tone="warning" testID="tile-not-checked-in" onPress={() => router.push('/(tabs)/attendance?filter=absent' as any)} />
                <StatTile basis={tileBasis} icon="close-circle-outline" label="Absent" value={String(data.todays_attendance.absent)} tone="error" testID="tile-absent" onPress={() => router.push('/(tabs)/attendance?filter=absent' as any)} />
                <StatTile basis={tileBasis} icon="alert-circle-outline" label="Missing Punch" value={String(data.todays_attendance.missing_punch)} tone="error" testID="tile-missing" onPress={() => router.push('/(tabs)/attendance?filter=missing' as any)} />
              </View>

              {hasModule('approvals') && (data.pending_approvals.attendance_corrections > 0 || data.pending_approvals.leave_requests > 0) && (
                <View style={[styles.approvalRow, { marginBottom: spacing.xl }]}>
                  {data.pending_approvals.attendance_corrections > 0 && (
                    <Pressable onPress={() => router.push('/approvals?tab=Corrections')} testID="approval-corrections">
                      <Badge tone="warning" label={`${data.pending_approvals.attendance_corrections} correction${data.pending_approvals.attendance_corrections === 1 ? '' : 's'}`} />
                    </Pressable>
                  )}
                  {data.pending_approvals.leave_requests > 0 && (
                    <Pressable onPress={() => router.push('/approvals?tab=Leaves')} testID="approval-leaves">
                      <Badge tone="warning" label={`${data.pending_approvals.leave_requests} leave request${data.pending_approvals.leave_requests === 1 ? '' : 's'}`} />
                    </Pressable>
                  )}
                </View>
              )}
            </Section>
          )}

          {/* Responsive section grid: Repairs / Tasks sit side-by-side on wide screens */}
          <View style={styles.sectionGrid}>
            {hasModule('repairs') && (
              <View style={{ flexBasis: sectionBasis, flexGrow: 1 }}>
                <Section title="Repairs" icon="construct-outline" testID="section-repairs">
                  <View style={styles.tileGrid}>
                    <StatTile basis={tileBasis} icon="cube-outline" label="Received · awaiting action" value={String(data.repairs_summary.received)} tone="info" testID="repairs-received" onPress={() => router.push('/repairs?filter=received' as any)} />
                    <StatTile basis={tileBasis} icon="hammer-outline" label="With Karigar" value={String(data.repairs_summary.with_karigar)} tone="brand" testID="repairs-with-karigar" onPress={() => router.push('/repairs?filter=with_karigar' as any)} />
                    <StatTile basis={tileBasis} icon="pricetag-outline" label="Pending to Bill" value={String(data.repairs_summary.ready)} tone="success" testID="repairs-ready" onPress={() => router.push('/repairs?filter=ready' as any)} />
                  </View>
                </Section>
              </View>
            )}

            {hasModule('tasks') && (
              <View style={{ flexBasis: sectionBasis, flexGrow: 1 }}>
                <Section title="Tasks" icon="checkbox-outline" testID="section-tasks">
                  <View style={styles.tileGrid}>
                    <StatTile basis={tileBasis} icon="today-outline" label="Due Today" value={String(data.tasks_summary.due_today)} tone="info" testID="tasks-due-today" onPress={() => router.push('/tasks' as any)} />
                    <StatTile basis={tileBasis} icon="alert-circle-outline" label="Overdue" value={String(data.tasks_summary.overdue)} tone="error" testID="tasks-overdue" onPress={() => router.push('/tasks' as any)} />
                  </View>
                </Section>
              </View>
            )}

            {hasModule('samples') && (
              <View style={{ flexBasis: sectionBasis, flexGrow: 1 }}>
                <Section title="Stock In/Out" icon="swap-horizontal-outline" testID="section-samples">
                  <View style={styles.tileGrid}>
                    <StatTile basis={tileBasis} icon="hammer-outline" label="With Karigar" value={String(data.samples_summary.with_karigar)} tone="brand" testID="samples-with-karigar" onPress={() => router.push('/samples?status=with_karigar' as any)} />
                    <StatTile basis={tileBasis} icon="alert-circle-outline" label="Overdue" value={String(data.samples_summary.overdue)} tone="error" testID="samples-overdue" onPress={() => router.push('/samples?status=overdue' as any)} />
                    <StatTile basis={tileBasis} icon="checkmark-circle-outline" label="Received Today" value={String(data.samples_summary.received_today)} tone="success" testID="samples-received-today" onPress={() => router.push('/samples?status=received' as any)} />
                  </View>
                </Section>
              </View>
            )}

            {hasModule('cash_book') && (
              <View style={{ flexBasis: sectionBasis, flexGrow: 1 }}>
                <Section title="Cash Book" icon="wallet-outline" testID="section-cashbook">
                  <View style={styles.tileGrid}>
                    <StatTile basis={tileBasis} icon="trending-up-outline" label="Received Today" value={fmtINR(data.cashbook_summary.received_today)} tone="success" testID="cashbook-received-today" onPress={() => router.push('/cashbook' as any)} />
                    <StatTile basis={tileBasis} icon="trending-down-outline" label="Paid Today" value={fmtINR(data.cashbook_summary.paid_today)} tone="error" testID="cashbook-paid-today" onPress={() => router.push('/cashbook' as any)} />
                    <StatTile basis={tileBasis} icon="wallet-outline" label="Counter Bal" value={fmtINR(data.cashbook_summary.closing_balance)} tone="brand" testID="cashbook-counter-bal" onPress={() => router.push('/cashbook' as any)} />
                  </View>
                </Section>
              </View>
            )}
          </View>

          <View style={{ height: spacing.xxl }} />
        </>
      ) : null}
    </Screen>
  );
}

// Mimics the attendance tile grid shape while the first load is in flight,
// instead of a bare centered spinner — see src/components/ui/Skeleton.tsx.
function DashboardSkeleton() {
  return (
    <View style={{ gap: spacing.sm }}>
      <Skeleton width="40%" height={14} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width="30%" height={64} radius={radius.sm} />
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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

  approvalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },

  sectionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
