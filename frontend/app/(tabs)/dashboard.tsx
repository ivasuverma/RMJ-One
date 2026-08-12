import { useCallback, useMemo, useState } from 'react';
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
};

export default function DashboardScreen() {
  const { user, hasModule } = useAuth();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const heroGradient = scheme === 'light'
    ? ['rgba(247,241,230,0.6)', 'rgba(247,241,230,0.92)'] as const
    : ['rgba(13,13,13,0.65)', 'rgba(13,13,13,0.92)'] as const;
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
            <Pressable onPress={load} style={styles.retryBtn} testID="dashboard-retry">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : data ? (
          <>
            {/* Today's Attendance hero */}
            {hasModule('attendance') && (
              <Pressable
                style={styles.heroCard}
                testID="attendance-hero-card"
                onPress={() => router.push('/(tabs)/attendance')}
              >
                <Image source={images.goldTexture} style={StyleSheet.absoluteFill} contentFit="cover" />
                <LinearGradient
                  colors={heroGradient}
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
                    <AttTile label="Absent" value={data.todays_attendance.absent} accent={colors.onError} testID="tile-absent" onPress={() => router.push('/(tabs)/attendance')} />
                    <AttTile label="Late" value={data.todays_attendance.late} accent={colors.brandSecondary} testID="tile-late" onPress={() => router.push('/(tabs)/attendance')} />
                    <AttTile label="Half Day" value={data.todays_attendance.half_day} accent={colors.onWarning} testID="tile-half-day" onPress={() => router.push('/(tabs)/attendance')} />
                    <AttTile label="Missing Punch" value={data.todays_attendance.missing_punch} accent={colors.onError} testID="tile-missing" onPress={() => router.push('/(tabs)/attendance')} />
                    <AttTile label="On Leave" value={data.todays_attendance.leave} accent={colors.onSurfaceTertiary} testID="tile-leave" onPress={() => router.push('/(tabs)/attendance')} />
                  </View>
                </View>
              </Pressable>
            )}

            {/* Pending Approvals */}
            {hasModule('approvals') && (
              <>
                <SectionHeader title="Pending Approvals" testID="section-approvals" />
                <View style={styles.listCard}>
                  <ApprovalRow icon="time-outline" label="Attendance Corrections" count={data.pending_approvals.attendance_corrections} testID="approval-corrections" onPress={() => router.push('/approvals?tab=Corrections')} />
                  <Divider />
                  <ApprovalRow icon="calendar-outline" label="Leave Requests" count={data.pending_approvals.leave_requests} testID="approval-leaves" onPress={() => router.push('/approvals?tab=Leaves')} />
                </View>
              </>
            )}

            {/* Repairs at a glance */}
            {hasModule('repairs') && (
              <>
                <SectionHeader title="Repairs" testID="section-repairs" />
                <View style={styles.listCard}>
                  <ApprovalRow icon="cube-outline" label="Received · awaiting action" count={data.repairs_summary.received} testID="repairs-received" onPress={() => router.push('/repairs/outstanding' as any)} />
                  <Divider />
                  <ApprovalRow icon="hammer-outline" label="With Karigar" count={data.repairs_summary.with_karigar} testID="repairs-with-karigar" onPress={() => router.push('/repairs/outstanding' as any)} />
                  <Divider />
                  <ApprovalRow icon="pricetag-outline" label="Pending to Bill" count={data.repairs_summary.ready} testID="repairs-ready" onPress={() => router.push('/repairs/outstanding' as any)} />
                  <Divider />
                  <ApprovalRow icon="alert-circle-outline" label="Overdue" count={data.repairs_summary.overdue} testID="repairs-overdue" danger onPress={() => router.push('/repairs/outstanding' as any)} />
                </View>
                <View style={styles.miniStatsRow}>
                  <MiniStat label="Delivered Today" value={data.repairs_summary.delivered_today} testID="repairs-delivered-today" onPress={() => router.push('/repairs' as any)} />
                  <MiniStat label="Total Open Tags" value={data.repairs_summary.total_open} testID="repairs-total-open" onPress={() => router.push('/repairs' as any)} />
                  <MiniStat label="New Intake" icon="add" accent testID="repairs-new" onPress={() => router.push('/repairs/new' as any)} />
                </View>
              </>
            )}

            {/* Tasks at a glance */}
            {hasModule('tasks') && (
              <>
                <SectionHeader title="Tasks" testID="section-tasks" />
                <View style={styles.listCard}>
                  <ApprovalRow icon="today-outline" label="Due Today" count={data.tasks_summary.due_today} testID="tasks-due-today" onPress={() => router.push('/tasks' as any)} />
                  <Divider />
                  <ApprovalRow icon="alert-circle-outline" label="Overdue" count={data.tasks_summary.overdue} testID="tasks-overdue" danger onPress={() => router.push('/tasks' as any)} />
                  <Divider />
                  <ApprovalRow icon="checkmark-done-outline" label="Completed Today" count={data.tasks_summary.done_today} testID="tasks-done-today" onPress={() => router.push('/tasks' as any)} />
                </View>
              </>
            )}

            {hasModule('team') && (
              <Pressable
                testID="quick-add-employee"
                onPress={() => router.push('/employee/new')}
                style={styles.cta}
              >
                <Ionicons name="add" size={20} color={colors.onBrandPrimary} />
                <Text style={styles.ctaText}>Add Employee</Text>
              </Pressable>
            )}

            <View style={{ height: spacing.xxl }} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function AttTile({ label, value, accent, testID, onPress }: { label: string; value: number; accent: string; testID?: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable style={({ pressed }) => [styles.attTile, pressed && { opacity: 0.7 }]} testID={testID} onPress={onPress}>
      <Text style={[styles.attValue, { color: accent }]}>{value}</Text>
      <Text style={styles.attLabel}>{label}</Text>
    </Pressable>
  );
}

function SectionHeader({ title, testID }: { title: string; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.sectionHeader} testID={testID}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function ApprovalRow({ icon, label, count, testID, onPress, danger }: { icon: any; label: string; count: number; testID?: string; onPress?: () => void; danger?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const highlight = danger && count > 0;
  return (
    <Pressable style={({ pressed }) => [styles.appRow, pressed && { opacity: 0.7 }]} testID={testID} onPress={onPress}>
      <View style={[styles.appIconWrap, highlight && { backgroundColor: colors.error }]}>
        <Ionicons name={icon} size={18} color={highlight ? colors.onError : colors.brandSecondary} />
      </View>
      <Text style={styles.appLabel}>{label}</Text>
      <View style={[styles.countPill, count === 0 && styles.countPillEmpty, highlight && { backgroundColor: colors.error }]}>
        <Text style={[styles.countPillText, count === 0 && styles.countPillTextEmpty, highlight && { color: colors.onError }]}>{count}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedText} style={{ marginLeft: 4 }} />
    </Pressable>
  );
}

function MiniStat({ label, value, icon, accent, testID, onPress }: { label?: string; value?: number; icon?: any; accent?: boolean; testID?: string; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable style={({ pressed }) => [styles.miniStat, accent && styles.miniStatAccent, pressed && { opacity: 0.75 }]} testID={testID} onPress={onPress}>
      {icon ? (
        <Ionicons name={icon} size={20} color={accent ? colors.onBrandPrimary : colors.brandSecondary} />
      ) : (
        <Text style={styles.miniStatValue}>{value}</Text>
      )}
      {label ? <Text style={[styles.miniStatLabel, accent && { color: colors.onBrandPrimary }]}>{label}</Text> : null}
    </Pressable>
  );
}

function Divider() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.divider} />;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
    backgroundColor: colors.success, borderColor: colors.onSuccess, borderWidth: 1,
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5,
  },
  heroChipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.onSuccess },
  heroChipText: { color: colors.onSuccess, fontSize: 11, fontWeight: '700' },

  attGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  attTile: {
    flexBasis: '31%', flexGrow: 1,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
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

  miniStatsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  miniStat: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md,
  },
  miniStatAccent: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  miniStatValue: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
  miniStatLabel: { color: colors.onSurfaceTertiary, fontSize: 10, textAlign: 'center' },

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
