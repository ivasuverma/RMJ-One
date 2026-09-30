import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { istTime, nowISTLongLabel, todayIST } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { PunchCaptureModal, PunchResult } from '@/src/components/PunchCaptureModal';
import { UploadQueueBadge } from '@/src/components/UploadQueueBadge';
import { AppSetupBanner } from '@/src/components/AppSetupBanner';
import { employeeTabAccess } from '@/src/components/EmployeeTabBar';
import { haptics } from '@/src/utils/haptics';
import { useToast } from '@/src/components/ui';
import { TabBarSpacer } from '@/src/components/GlassTabBar';
import { useCachedLoad } from '@/src/hooks/use-cached-load';
import { RateTicker, QuickRow, QuickItem, NeedsSection, NotificationsSection, QUICK_ROUTE } from '@/src/components/home/sections';
import { QUICK_ICON } from '@/src/components/home/QuickSheets';
import { HomeSummary, isOk } from '@/src/components/home/types';
import { StickyHeader, useScrolled, HeaderSpacer } from '@/src/components/ui/StickyHeader';


type Att = {
  id?: string;
  check_in?: { timestamp: string; latitude: number; longitude: number } | null;
  check_out?: { timestamp: string; latitude: number; longitude: number } | null;
  is_late?: boolean;
  working_hours?: number;
  status?: string;
};

type Task = { id: string; title: string; due_date?: string };

type Store = { work_start?: string; work_end?: string; grace_min?: number; name?: string; radius_m?: number; app_checkin_enabled?: boolean };

const EMP_ORDER = ['rates', 'punch', 'quick_actions', 'needs_you', 'notifications'];

type HomeData = { day: string; att: Att; store: Store; tasks: Task[] };

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  const t = istTime(iso);
  return t || iso;
};

export default function EmployeeHome() {
  const { scrolled, onScroll } = useScrolled();
  const { user, hasModule } = useAuth();
  // Work-from-home staff don't record attendance — hide the punch card and
  // the check-in/out reminders for them.
  const isRemote = !!user?.remote;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const toast = useToast();
  const router = useRouter();
  const [pulled, setPulled] = useState(false);
  const [showPunch, setShowPunch] = useState<null | 'check_in' | 'check_out'>(null);
  const [unread, setUnread] = useState(0);

  // The last copy saved on this phone paints instantly; fresh data swaps in behind it.
  const { data, loading: fetching, reload } = useCachedLoad<HomeData>(user ? `emp_home_v1:${user.id}` : null, async () => {
    const [a, s] = await Promise.all([
      api.get<Att>('/attendance/me/today'),
      api.get<Store>('/settings/store').catch(() => ({} as Store)),
    ]);
    return { day: todayIST(), att: a || {}, store: s || {}, tasks: [] };
  }, 120000);
  // Rates, quick actions, Needs you and notifications — the same briefing the owner's Home
  // uses, already filtered by the server to what this person may see.
  const brief = useCachedLoad<HomeSummary>(user ? `home_summary_v1:${user.id}` : null,
    (fresh) => api.get<HomeSummary>(`/home/summary${fresh ? '?fresh=1' : ''}`));
  const summary = brief.data;
  const loading = !data;
  const today = todayIST();
  // A copy saved on an earlier day says nothing about today's punch.
  const att: Att | null = data ? (data.day === today ? data.att : {}) : null;
  const store: Store = data?.store || {};
  const load = reload;
  const refreshing = pulled && fetching;
  useEffect(() => { if (!fetching) setPulled(false); }, [fetching]);

  useFocusEffect(useCallback(() => {
    api.get<{ count: number }>('/notifications/unread-count').then((r) => setUnread(r.count)).catch(() => {});
  }, []));

  const doPunch = async (r: PunchResult) => {
    const endpoint = showPunch === 'check_in' ? '/attendance/check-in' : '/attendance/check-out';
    try {
      await api.post(endpoint, r);
      haptics.success();
      setShowPunch(null);
      await load();
      toast.success(showPunch === 'check_in' ? 'Checked in successfully.' : 'Checked out successfully.');
    } catch (e: any) {
      haptics.error();
      notify('Failed', e?.detail || 'Please try again');
    }
  };


  const hasCheckIn = !!att?.check_in;
  const hasCheckOut = !!att?.check_out;
  const appCheckinEnabled = store.app_checkin_enabled !== false;

  const now = new Date();
  const reminderCheckIn = appCheckinEnabled && !hasCheckIn && shouldRemindCheckIn(now, store.work_start, store.grace_min);
  const reminderCheckOut = appCheckinEnabled && hasCheckIn && !hasCheckOut && shouldRemindCheckOut(now, store.work_end);

  // Each Home section, in this person's order (Settings › Home screen); the punch card
  // group also carries the setup banner and check-in/out reminders.
  const blocks: Record<string, ReactNode> = {
    rates: (
      <>
        <RateTicker rates={isOk(summary?.rates) ? summary!.rates : null} loading={!summary} />
      </>
    ),
    punch: (
      <>
        <View style={{ marginTop: spacing.md }}>
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
            <View style={styles.punchTopRow}>
              <Text style={styles.punchLabel}>TODAY&apos;S PUNCH</Text>
              {!!att?.is_late && <View style={styles.lateBadge}><Ionicons name="warning-outline" size={11} color={colors.onWarning} /><Text style={styles.lateText}>Late</Text></View>}
              {!!att?.working_hours && <Text style={styles.hoursText}>{att.working_hours}h worked</Text>}
            </View>
            <View style={styles.punchRow}>
              <PunchSlot label="Check In" time={fmtTime(att?.check_in?.timestamp)} icon="log-in-outline" done={hasCheckIn} testID="slot-check-in" />
              <View style={styles.punchDivider} />
              <PunchSlot label="Check Out" time={fmtTime(att?.check_out?.timestamp)} icon="log-out-outline" done={hasCheckOut} testID="slot-check-out" />
            </View>

            {!appCheckinEnabled && (
              <View style={styles.doneBadge} testID="app-checkin-disabled-notice">
                <Ionicons name="finger-print-outline" size={16} color={colors.mutedText} />
                <Text style={styles.doneText}>Punch in and out on the biometric machine at the shop — your times show here.</Text>
              </View>
            )}
            {appCheckinEnabled && !hasCheckIn && (
              <Pressable onPress={() => setShowPunch('check_in')} style={styles.punchBtn} testID="btn-check-in">
                <Ionicons name="log-in" size={18} color={colors.onBrandPrimary} />
                <Text style={styles.punchBtnText}>Check In</Text>
              </Pressable>
            )}
            {appCheckinEnabled && hasCheckIn && !hasCheckOut && (
              <Pressable onPress={() => setShowPunch('check_out')} style={[styles.punchBtn, styles.punchBtnOut]} testID="btn-check-out">
                <Ionicons name="log-out" size={18} color={colors.onSurface} />
                <Text style={[styles.punchBtnText, { color: colors.onSurface }]}>Check Out</Text>
              </Pressable>
            )}
            {appCheckinEnabled && hasCheckIn && hasCheckOut && (
              <View style={styles.doneBadge} testID="punch-done-badge">
                <Ionicons name="checkmark-circle" size={16} color={colors.brandPrimary} />
                <Text style={styles.doneText}>All punches done · See you tomorrow</Text>
              </View>
            )}
          </View>
          )}

          {/* Install-to-home-screen + enable-notifications onboarding */}
          <AppSetupBanner />

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

        </View>
      </>
    ),
    quick_actions: (
      <>
        {/* Quick actions — their own Calendar, Leave and Ledger first (work-from-home staff
            have no attendance, so no Calendar or Leave), then the create shortcuts for the
            modules the owner gave them Edit rights on. */}
        <QuickRow items={[
          ...(!isRemote ? [
            { key: 'calendar', label: 'Calendar', icon: 'calendar-outline', onPress: () => router.push('/(emp)/calendar' as any) },
            { key: 'leave', label: 'Leave', icon: 'airplane-outline', onPress: () => router.push('/leaves') },
          ] as QuickItem[] : []),
          { key: 'ledger', label: 'My Ledger', icon: 'book-outline', onPress: () => router.push(`/ledger/${user?.id}`) },
          // My Tasks otherwise lives in the Work hub; with no Work tab this is the way to it.
          ...(!employeeTabAccess(hasModule).work ? [{ key: 'tasks', label: 'My Tasks', icon: 'checkbox-outline', onPress: () => router.push('/(emp)/tasks' as any) }] as QuickItem[] : []),
          ...(isOk(summary?.quick_actions) ? summary!.quick_actions.tiles.filter((t) => QUICK_ROUTE[t.key]).map((t) => ({
            key: t.key, label: t.label, icon: QUICK_ICON[t.key] || 'ellipse-outline', onPress: () => router.push(QUICK_ROUTE[t.key] as any),
          })) : []),
        ]} />

      </>
    ),
    needs_you: (
      <>
        <NeedsSection needs={summary ? summary.needs_you : undefined} loading={!summary} />
      </>
    ),
    notifications: (
      <>
        <NotificationsSection data={isOk(summary?.notifications) ? summary!.notifications : null} />
      </>
    ),
  };
  const order = summary?.section_order?.length ? summary.section_order : EMP_ORDER;

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-home-screen">
      <StickyHeader scrolled={scrolled} style={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 }}>
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
      </StickyHeader>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setPulled(true); load(); brief.refresh(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        <HeaderSpacer />

        {loading ? (
          <View style={{ paddingVertical: 80, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg }}>
            {order.map((k) => <Fragment key={k}>{blocks[k]}</Fragment>)}
          </View>
        )}
        <TabBarSpacer />
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

// Compact, chrome-free layout — an icon and two lines of text, no boxed
// background/border per slot (the old design), just typography + a thin
// divider between the two slots for the "Apple style" ask.
function PunchSlot({ label, time, icon, done, testID }: { label: string; time: string; icon: any; done: boolean; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.slot} testID={testID}>
      <Ionicons name={icon} size={16} color={done ? colors.brandPrimary : colors.mutedText} />
      <View style={{ marginLeft: spacing.sm }}>
        <Text style={styles.slotLabel}>{label}</Text>
        <Text style={[styles.slotTime, done && { color: colors.onSurface }]}>{done ? time : '—:—'}</Text>
      </View>
    </View>
  );
}



const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.md },
  hero: { height: 180, position: 'relative' },
  heroInner: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md, justifyContent: 'space-between', paddingBottom: spacing.lg },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 22 },
  avatarPhoto: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surfaceTertiary },
  heroLabel: { color: colors.brandSecondary, fontSize: 11, letterSpacing: 1 },
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
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md,
  },
  punchTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  punchLabel: { flex: 1, color: colors.brandSecondary, fontSize: 11, letterSpacing: 1 },
  punchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  slot: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  punchDivider: { width: 1, height: 30, backgroundColor: colors.border, marginHorizontal: spacing.md },
  slotLabel: { color: colors.mutedText, fontSize: 11 },
  slotTime: { color: colors.mutedText, fontSize: 15, fontWeight: '700', marginTop: 1 },

  lateBadge: {
    flexDirection: 'row', gap: 4, alignItems: 'center',
    backgroundColor: colors.warning, borderColor: colors.onWarning, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill,
  },
  lateText: { color: colors.onWarning, fontSize: 11, fontWeight: '700' },
  hoursText: { color: colors.onSurfaceTertiary, fontSize: 11.5 },

  punchBtn: {
    flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: 11, marginTop: spacing.sm,
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
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  moduleTile: {
    flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
  },
  moduleTileIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  moduleTileLabel: { flex: 1, color: colors.onSurface, fontSize: 13.5, fontWeight: '600' },
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
