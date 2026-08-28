import { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  ActivityIndicator, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { istTime, nowISTLongLabel, todayIST } from '@/src/utils/datetime';
import { spacing, radius, images, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { PunchCaptureModal, PunchResult } from '@/src/components/PunchCaptureModal';
import { UploadQueueBadge } from '@/src/components/UploadQueueBadge';
import { haptics } from '@/src/utils/haptics';

type Att = {
  id?: string;
  check_in?: { timestamp: string; latitude: number; longitude: number } | null;
  check_out?: { timestamp: string; latitude: number; longitude: number } | null;
  is_late?: boolean;
  working_hours?: number;
  status?: string;
};

type Store = { work_start?: string; work_end?: string; grace_min?: number; name?: string; radius_m?: number; app_checkin_enabled?: boolean };

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  const t = istTime(iso);
  return t || iso;
};

export default function EmployeeHome() {
  const { user } = useAuth();
  // Work-from-home staff don't record attendance — hide the punch card and
  // the check-in/out reminders for them.
  const isRemote = !!user?.remote;
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const heroGradient = scheme === 'light'
    ? ['rgba(247,241,230,0.4)', 'rgba(247,241,230,0.98)'] as const
    : ['rgba(13,13,13,0.5)', 'rgba(13,13,13,0.98)'] as const;
  const router = useRouter();
  const [att, setAtt] = useState<Att | null>(null);
  const [store, setStore] = useState<Store>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPunch, setShowPunch] = useState<null | 'check_in' | 'check_out'>(null);
  const [unread, setUnread] = useState(0);
  const [myTasks, setMyTasks] = useState<{ id: string; title: string; due_date?: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const [a, s, t] = await Promise.all([
        api.get<Att>('/attendance/me/today').catch(() => ({} as Att)),
        api.get<Store>('/settings/store').catch(() => ({} as Store)),
        api.get<{ id: string; title: string; due_date?: string }[]>('/tasks?status=open').catch(() => []),
      ]);
      setAtt(a || {});
      setStore(s || {});
      // Due-today or overdue only — what actually needs doing now, newest due first.
      const today = todayIST();
      setMyTasks((t || []).filter((x) => x.due_date && x.due_date <= today).sort((x, y) => (x.due_date || '').localeCompare(y.due_date || '')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    api.get<{ count: number }>('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => {});
  }, [load]));

  const doPunch = async (r: PunchResult) => {
    const endpoint = showPunch === 'check_in' ? '/attendance/check-in' : '/attendance/check-out';
    try {
      await api.post(endpoint, r);
      haptics.success();
      setShowPunch(null);
      await load();
      Alert.alert('Success', showPunch === 'check_in' ? 'Checked in successfully.' : 'Checked out successfully.');
    } catch (e: any) {
      haptics.error();
      Alert.alert('Failed', e?.detail || 'Please try again');
    }
  };


  const hasCheckIn = !!att?.check_in;
  const hasCheckOut = !!att?.check_out;
  const appCheckinEnabled = store.app_checkin_enabled !== false;

  const now = new Date();
  const reminderCheckIn = appCheckinEnabled && !hasCheckIn && shouldRemindCheckIn(now, store.work_start, store.grace_min);
  const reminderCheckOut = appCheckinEnabled && hasCheckIn && !hasCheckOut && shouldRemindCheckOut(now, store.work_end);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-home-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Flat header — same clean language as the admin dashboard. */}
        <View style={styles.header}>
          {user?.photo ? (
            <Image source={{ uri: user.photo }} style={styles.avatarPhoto} />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || 'E')[0]?.toUpperCase()}</Text></View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.dateText}>{nowISTLongLabel()}</Text>
            <Text style={styles.heroName} numberOfLines={1}>{user?.name}</Text>
            <Text style={styles.heroCode}>{user?.employee_code} · {user?.designation || '—'}</Text>
          </View>
          <UploadQueueBadge />
          <Pressable onPress={() => router.push('/notifications' as any)} style={styles.iconBtn} testID="emp-notifications-btn" hitSlop={12}>
            <Ionicons name="notifications-outline" size={20} color={colors.onSurface} />
            {unread > 0 && <View style={styles.bellDot} />}
          </Pressable>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 80, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
            {/* Reminder banners */}
            {!isRemote && reminderCheckIn && (
              <ReminderBanner
                testID="reminder-checkin"
                icon="alarm-outline" color={colors.warning}
                title="Check-In Reminder"
                subtitle="You haven't punched in today. Punch in now, or tap a day on your Calendar to request a correction."
                actions={[
                  { label: 'Punch In', onPress: () => setShowPunch('check_in'), primary: true, testID: 'reminder-checkin-btn' },
                ]}
              />
            )}
            {!isRemote && reminderCheckOut && (
              <ReminderBanner
                testID="reminder-checkout"
                icon="alarm-outline" color={colors.warning}
                title="Check-Out Reminder"
                subtitle="You haven't punched out yet. Don't forget!"
                actions={[
                  { label: 'Punch Out', onPress: () => setShowPunch('check_out'), primary: true, testID: 'reminder-checkout-btn' },
                ]}
              />
            )}

            {/* Punch card — hidden entirely for work-from-home staff */}
            {isRemote && (
              <View style={styles.punchCard} testID="remote-card">
                <Text style={styles.punchLabel}>WORK FROM HOME</Text>
                <View style={styles.doneBadge}>
                  <Ionicons name="home" size={18} color={colors.brandPrimary} />
                  <Text style={styles.doneText}>No attendance to record. Your salary is paid in full each month.</Text>
                </View>
              </View>
            )}
            {!isRemote && (
            <View style={styles.punchCard} testID="punch-card">
              <Text style={styles.punchLabel}>TODAY&apos;S PUNCH</Text>
              <View style={styles.punchRow}>
                <PunchSlot label="Check In" time={fmtTime(att?.check_in?.timestamp)} icon="log-in-outline" done={hasCheckIn} testID="slot-check-in" />
                <PunchSlot label="Check Out" time={fmtTime(att?.check_out?.timestamp)} icon="log-out-outline" done={hasCheckOut} testID="slot-check-out" />
              </View>

              {!!att?.is_late && <View style={styles.lateBadge}><Ionicons name="warning-outline" size={12} color={colors.onWarning} /><Text style={styles.lateText}>Marked late today</Text></View>}
              {!!att?.working_hours && <Text style={styles.hoursText}>{att.working_hours} hours worked today</Text>}

              {!appCheckinEnabled && (
                <View style={styles.doneBadge} testID="app-checkin-disabled-notice">
                  <Ionicons name="finger-print-outline" size={18} color={colors.mutedText} />
                  <Text style={styles.doneText}>Attendance is tracked via biometric device here. Check-in/out from the app is turned off.</Text>
                </View>
              )}
              {appCheckinEnabled && !hasCheckIn && (
                <Pressable onPress={() => setShowPunch('check_in')} style={styles.punchBtn} testID="btn-check-in">
                  <Ionicons name="log-in" size={20} color={colors.onBrandPrimary} />
                  <Text style={styles.punchBtnText}>Check In</Text>
                </Pressable>
              )}
              {appCheckinEnabled && hasCheckIn && !hasCheckOut && (
                <Pressable onPress={() => setShowPunch('check_out')} style={[styles.punchBtn, styles.punchBtnOut]} testID="btn-check-out">
                  <Ionicons name="log-out" size={20} color={colors.onSurface} />
                  <Text style={[styles.punchBtnText, { color: colors.onSurface }]}>Check Out</Text>
                </Pressable>
              )}
              {appCheckinEnabled && hasCheckIn && hasCheckOut && (
                <View style={styles.doneBadge} testID="punch-done-badge">
                  <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} />
                  <Text style={styles.doneText}>All punches done · See you tomorrow</Text>
                </View>
              )}
            </View>
            )}

            {/* My tasks due today / overdue */}
            {myTasks.length > 0 && (
              <>
                <View style={styles.taskHeaderRow}>
                  <Text style={styles.section}>My tasks today</Text>
                  <Pressable onPress={() => router.push('/(emp)/tasks' as any)} testID="emp-tasks-see-all">
                    <Text style={styles.taskSeeAll}>See all</Text>
                  </Pressable>
                </View>
                <View style={styles.taskCard}>
                  {myTasks.slice(0, 4).map((t, i) => {
                    const overdue = !!t.due_date && t.due_date < todayIST();
                    return (
                      <Pressable
                        key={t.id}
                        testID={`emp-task-${t.id}`}
                        onPress={() => router.push('/(emp)/tasks' as any)}
                        style={({ pressed }) => [styles.taskRow, i === Math.min(myTasks.length, 4) - 1 && styles.taskRowLast, pressed && { opacity: 0.7 }]}
                      >
                        <View style={[styles.taskDot, { backgroundColor: overdue ? colors.onError : colors.brandPrimary }]} />
                        <Text style={styles.taskTitle} numberOfLines={1}>{t.title}</Text>
                        {overdue && <Text style={styles.taskOverdue}>Overdue</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {/* Quick actions — work-from-home staff have no attendance, so
                Calendar and Leave request are dropped for them. */}
            <Text style={styles.section}>Quick actions</Text>
            <View style={styles.actionsRow}>
              {!isRemote && <ActionCard icon="calendar-outline" label="Calendar" onPress={() => router.push('/(emp)/calendar' as any)} testID="action-calendar" />}
              {!isRemote && <ActionCard icon="airplane-outline" label="Leave request" onPress={() => router.push('/leaves')} testID="action-leave" />}
              <ActionCard icon="book-outline" label="My Ledger" onPress={() => router.push(`/ledger/${user?.id}`)} testID="action-ledger" />
            </View>
          </View>
        )}
      </ScrollView>

      {showPunch && (
        <PunchCaptureModal
          visible={!!showPunch}
          mode={showPunch}
          onClose={() => setShowPunch(null)}
          onCapture={doPunch}
        />
      )}
    </SafeAreaView>
  );
}

function shouldRemindCheckIn(now: Date, work_start?: string, grace_min?: number): boolean {
  if (!work_start) return false;
  const [h, m] = work_start.split(':').map((x) => parseInt(x, 10));
  const startMin = (h || 0) * 60 + (m || 0);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin > startMin + (grace_min || 15);
}
function shouldRemindCheckOut(now: Date, work_end?: string): boolean {
  if (!work_end) return false;
  const [h, m] = work_end.split(':').map((x) => parseInt(x, 10));
  const endMin = (h || 0) * 60 + (m || 0);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin > endMin;
}

function ReminderBanner({ icon, color, title, subtitle, actions, testID }: {
  icon: any; color: string; title: string; subtitle: string;
  actions: { label: string; onPress: () => void; primary?: boolean; testID?: string }[];
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.banner, { borderColor: color }]} testID={testID}>
      <View style={styles.bannerTop}>
        <View style={[styles.bannerIcon, { backgroundColor: color }]}>
          <Ionicons name={icon} size={16} color={colors.onSurface} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>{title}</Text>
          <Text style={styles.bannerSub}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.bannerActions}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            testID={a.testID}
            onPress={a.onPress}
            style={[styles.bannerBtn, a.primary && styles.bannerBtnPrimary]}
          >
            <Text style={[styles.bannerBtnText, a.primary && styles.bannerBtnTextPrimary]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PunchSlot({ label, time, icon, done, testID }: { label: string; time: string; icon: any; done: boolean; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.slot, done && styles.slotDone]} testID={testID}>
      <View style={styles.slotIconWrap}>
        <Ionicons name={icon} size={18} color={done ? colors.brandPrimary : colors.mutedText} />
      </View>
      <Text style={styles.slotLabel}>{label}</Text>
      <Text style={[styles.slotTime, done && { color: colors.onSurface }]}>{done ? time : '—:—'}</Text>
    </View>
  );
}

function ActionCard({ icon, label, onPress, testID }: { icon: any; label: string; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={styles.actionCard} testID={testID}>
      <View style={styles.actionIcon}><Ionicons name={icon} size={20} color={colors.brandSecondary} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  hero: { height: 180, position: 'relative' },
  heroInner: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md, justifyContent: 'space-between', paddingBottom: spacing.lg },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 22 },
  avatarPhoto: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceTertiary },
  heroLabel: { color: colors.brandSecondary, fontSize: 10, letterSpacing: 1 },
  heroName: {
    color: colors.onSurface, fontSize: 22, fontWeight: '700',
    fontFamily: fonts.display,
  },
  heroCode: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceSecondary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4,
    backgroundColor: colors.error, borderWidth: 1, borderColor: colors.surfaceSecondary,
  },
  dateText: { color: colors.brandSecondary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },

  banner: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    padding: spacing.md, marginBottom: spacing.md,
  },
  bannerTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  bannerIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bannerTitle: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  bannerSub: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  bannerActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  bannerBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  bannerBtnPrimary: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  bannerBtnText: { color: colors.onSurfaceSecondary, fontWeight: '600', fontSize: 12 },
  bannerBtnTextPrimary: { color: colors.onBrandPrimary },

  punchCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg,
  },
  punchLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, marginBottom: spacing.md },
  punchRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  slot: {
    flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  slotDone: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  slotIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  slotLabel: { color: colors.mutedText, fontSize: 11 },
  slotTime: { color: colors.mutedText, fontSize: 18, fontWeight: '700', marginTop: 2 },

  lateBadge: {
    flexDirection: 'row', gap: 4, alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: colors.warning, borderColor: colors.onWarning, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginBottom: spacing.sm,
  },
  lateText: { color: colors.onWarning, fontSize: 11, fontWeight: '700' },
  hoursText: { color: colors.onSurfaceTertiary, fontSize: 12, marginBottom: spacing.md },

  punchBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.sm,
  },
  punchBtnOut: { backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.brand },
  punchBtnText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 15, letterSpacing: 0.4 },

  doneBadge: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandTertiary, borderColor: colors.brandPrimary, borderWidth: 1,
    borderRadius: radius.md, paddingVertical: 12, marginTop: spacing.sm,
  },
  doneText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13 },

  section: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginTop: spacing.xl, marginBottom: spacing.sm },
  taskHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  taskSeeAll: { color: colors.brandSecondary, fontSize: 12, fontWeight: '700', marginTop: spacing.xl },
  taskCard: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  taskRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: 12, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  taskRowLast: { borderBottomWidth: 0 },
  taskDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { flex: 1, color: colors.onSurface, fontSize: 13.5, fontWeight: '600' },
  taskOverdue: { color: colors.onError, fontSize: 11, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: spacing.md },
  actionCard: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: 'center', gap: spacing.sm,
  },
  actionIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand,
  },
  actionLabel: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
});
