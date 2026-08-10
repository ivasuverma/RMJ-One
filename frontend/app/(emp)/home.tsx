import { useCallback, useState } from 'react';
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
import { colors, spacing, radius, images, fonts } from '@/src/theme';
import { PunchCaptureModal, PunchResult } from '@/src/components/PunchCaptureModal';

type Att = {
  id?: string;
  check_in?: { timestamp: string; latitude: number; longitude: number } | null;
  check_out?: { timestamp: string; latitude: number; longitude: number } | null;
  is_late?: boolean;
  working_hours?: number;
  status?: string;
};

type Store = { work_start?: string; work_end?: string; grace_min?: number; name?: string; radius_m?: number };

const fmtTime = (iso?: string) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
};

export default function EmployeeHome() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [att, setAtt] = useState<Att | null>(null);
  const [store, setStore] = useState<Store>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showPunch, setShowPunch] = useState<null | 'check_in' | 'check_out'>(null);

  const load = useCallback(async () => {
    try {
      const [a, s] = await Promise.all([
        api.get<Att>('/attendance/me/today').catch(() => ({} as Att)),
        api.get<Store>('/settings/store').catch(() => ({} as Store)),
      ]);
      setAtt(a || {});
      setStore(s || {});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doPunch = async (r: PunchResult) => {
    const endpoint = showPunch === 'check_in' ? '/attendance/check-in' : '/attendance/check-out';
    try {
      await api.post(endpoint, r);
      setShowPunch(null);
      await load();
      Alert.alert('Success', showPunch === 'check_in' ? 'Checked in successfully.' : 'Checked out successfully.');
    } catch (e: any) {
      Alert.alert('Failed', e?.detail || 'Please try again');
    }
  };

  const onLogout = async () => { await logout(); router.replace('/login'); };

  const hasCheckIn = !!att?.check_in;
  const hasCheckOut = !!att?.check_out;

  const now = new Date();
  const reminderCheckIn = !hasCheckIn && shouldRemindCheckIn(now, store.work_start, store.grace_min);
  const reminderCheckOut = hasCheckIn && !hasCheckOut && shouldRemindCheckOut(now, store.work_end);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-home-screen">
      <ScrollView
        contentContainerStyle={{ paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero header */}
        <View style={styles.hero}>
          <Image source={images.goldTexture} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={['rgba(13,13,13,0.5)', 'rgba(13,13,13,0.98)']} style={StyleSheet.absoluteFill} />
          <View style={styles.heroInner}>
            <View style={styles.heroTopRow}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{(user?.name || 'E')[0]?.toUpperCase()}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroLabel}>WELCOME</Text>
                <Text style={styles.heroName} numberOfLines={1}>{user?.name}</Text>
                <Text style={styles.heroCode}>{user?.employee_code} · {user?.designation || '—'}</Text>
              </View>
              <Pressable onPress={onLogout} style={styles.iconBtn} testID="emp-logout-btn" hitSlop={12}>
                <Ionicons name="log-out-outline" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
            <Text style={styles.dateText}>{now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          </View>
        </View>

        {loading ? (
          <View style={{ paddingVertical: 80, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brandPrimary} size="large" />
          </View>
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, marginTop: spacing.lg }}>
            {/* Reminder banners */}
            {reminderCheckIn && (
              <ReminderBanner
                testID="reminder-checkin"
                icon="alarm-outline" color={colors.warning}
                title="Check-In Reminder"
                subtitle="You haven't punched in today. Punch in now or request a correction."
                actions={[
                  { label: 'Punch In', onPress: () => setShowPunch('check_in'), primary: true, testID: 'reminder-checkin-btn' },
                  { label: 'Request Correction', onPress: () => router.push('/attendance/correction'), testID: 'reminder-correction-btn' },
                ]}
              />
            )}
            {reminderCheckOut && (
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

            {/* Punch card */}
            <View style={styles.punchCard} testID="punch-card">
              <Text style={styles.punchLabel}>TODAY&apos;S PUNCH</Text>
              <View style={styles.punchRow}>
                <PunchSlot label="Check In" time={fmtTime(att?.check_in?.timestamp)} icon="log-in-outline" done={hasCheckIn} testID="slot-check-in" />
                <PunchSlot label="Check Out" time={fmtTime(att?.check_out?.timestamp)} icon="log-out-outline" done={hasCheckOut} testID="slot-check-out" />
              </View>

              {!!att?.is_late && <View style={styles.lateBadge}><Ionicons name="warning-outline" size={12} color="#F1D890" /><Text style={styles.lateText}>Marked late today</Text></View>}
              {!!att?.working_hours && <Text style={styles.hoursText}>{att.working_hours} hours worked today</Text>}

              {!hasCheckIn && (
                <Pressable onPress={() => setShowPunch('check_in')} style={styles.punchBtn} testID="btn-check-in">
                  <Ionicons name="log-in" size={20} color={colors.onBrandPrimary} />
                  <Text style={styles.punchBtnText}>Check In</Text>
                </Pressable>
              )}
              {hasCheckIn && !hasCheckOut && (
                <Pressable onPress={() => setShowPunch('check_out')} style={[styles.punchBtn, styles.punchBtnOut]} testID="btn-check-out">
                  <Ionicons name="log-out" size={20} color={colors.onSurface} />
                  <Text style={[styles.punchBtnText, { color: colors.onSurface }]}>Check Out</Text>
                </Pressable>
              )}
              {hasCheckIn && hasCheckOut && (
                <View style={styles.doneBadge} testID="punch-done-badge">
                  <Ionicons name="checkmark-circle" size={18} color={colors.brandPrimary} />
                  <Text style={styles.doneText}>All punches done · See you tomorrow</Text>
                </View>
              )}
            </View>

            {/* Quick actions */}
            <Text style={styles.section}>Quick actions</Text>
            <View style={styles.actionsRow}>
              <ActionCard icon="calendar-outline" label="My Calendar" onPress={() => router.push(`/attendance/calendar/${user?.id}`)} testID="action-my-calendar" />
              <ActionCard icon="create-outline" label="Correction" onPress={() => router.push('/attendance/correction')} testID="action-correction" />
              <ActionCard icon="airplane-outline" label="Apply Leave" onPress={() => router.push('/leaves/new')} testID="action-leave" />
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
  return (
    <Pressable onPress={onPress} style={styles.actionCard} testID={testID}>
      <View style={styles.actionIcon}><Ionicons name={icon} size={20} color={colors.brandSecondary} /></View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 180, position: 'relative' },
  heroInner: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md, justifyContent: 'space-between', paddingBottom: spacing.lg },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.onBrandPrimary, fontWeight: '800', fontSize: 22 },
  heroLabel: { color: colors.brandSecondary, fontSize: 10, letterSpacing: 1 },
  heroName: {
    color: colors.onSurface, fontSize: 22, fontWeight: '700',
    fontFamily: fonts.display,
  },
  heroCode: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(38,38,38,0.85)',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  dateText: { color: colors.onSurfaceTertiary, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },

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
  slotIconWrap: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  slotLabel: { color: colors.mutedText, fontSize: 11 },
  slotTime: { color: colors.mutedText, fontSize: 18, fontWeight: '700', marginTop: 2 },

  lateBadge: {
    flexDirection: 'row', gap: 4, alignItems: 'center', alignSelf: 'flex-start',
    backgroundColor: 'rgba(163,125,30,0.25)', borderColor: colors.warning, borderWidth: 1,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, marginBottom: spacing.sm,
  },
  lateText: { color: '#F1D890', fontSize: 11, fontWeight: '700' },
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
