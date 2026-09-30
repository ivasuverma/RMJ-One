import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Platform, ActivityIndicator,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { TimeInput } from '@/src/components/TimeInput';
import { displayDateOnly, istTime24 } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Correction = {
  id: string; employee_name: string; employee_code: string; date: string;
  reason_type: string; note: string; status: 'pending' | 'approved' | 'rejected';
  created_at: string; desired_check_in?: string | null; desired_check_out?: string | null;
  current?: DaySummary | null;                       // pending: the day as it stands now
  before?: DaySummary | null; after?: DaySummary | null;   // approved: what approving changed
};
type DaySummary = { check_in?: string | null; check_out?: string | null; working_hours?: number; status?: string | null };
// One side of the comparison, as display strings.
type DayView = { in: string; out: string; hours: string; status: string; note?: string; bad?: boolean };

const STATUS_LABEL: Record<string, string> = { present: 'Present', half_day: 'Half day', absent: 'Absent', leave: 'Leave', holiday: 'Holiday', weekly_off: 'Weekly off' };
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim()); return m ? +m[1] * 60 + +m[2] : null; };
const fmtHours = (h?: number | null) => (h ? `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}m` : '—');
const viewOf = (d?: DaySummary | null): DayView => d
  ? { in: d.check_in ? istTime24(d.check_in) : '—', out: d.check_out ? istTime24(d.check_out) : '—', hours: fmtHours(d.working_hours), status: STATUS_LABEL[d.status || ''] || '—' }
  : { in: '—', out: '—', hours: '—', status: 'No record' };
// What approving a pending correction would make the day: the approver's times over the current ones.
function projected(cur: DayView, t: { in: string; out: string }, hasRecord: boolean): DayView {
  const tin = t.in.trim() || (cur.in !== '—' ? cur.in : '');
  const tout = t.out.trim() || (cur.out !== '—' ? cur.out : '');
  if (!t.in.trim() && !t.out.trim()) {
    return hasRecord ? { ...cur } : { in: '—', out: '—', hours: '8h 00m', status: 'Present' };
  }
  const a = toMin(tin);
  let b = toMin(tout);
  let out = tout || '—';
  let note: string | undefined;
  // Same rule as the server: a morning check-out before the check-in means PM ("8:00" → 20:00).
  if (t.out.trim() && a !== null && b !== null && b <= a && b < 720 && b + 720 > a) {
    b += 720;
    out = `${String(Math.floor(b / 60)).padStart(2, '0')}:${String(b % 60).padStart(2, '0')}`;
    note = `${tout} read as ${out} (PM)`;
  }
  const bad = a !== null && b !== null && b <= a;
  const hrs = a !== null && b !== null && b > a ? (b - a) / 60 : 0;
  return {
    in: tin || '—', out, hours: bad ? 'Out before In' : fmtHours(hrs),
    status: hrs ? (hrs >= 4 ? 'Present' : 'Half day') : 'Present', note, bad,
  };
}
type Leave = {
  id: string; employee_name: string; employee_code: string;
  from_date: string; to_date: string; leave_type: string; reason: string;
  status: 'pending' | 'approved' | 'rejected'; created_at: string;
};

const TABS = ['Corrections', 'Leaves'] as const;

const reasonLabel = (r: string) => ({
  forgot_check_in: 'Forgot Check-In', forgot_check_out: 'Forgot Check-Out',
  machine_error: 'Machine Error', other: 'Other',
} as any)[r] || r;

// date/from_date/to_date here are all bare 'YYYY-MM-DD' — no timestamp.
const fmtDate = (s?: string) => (s ? displayDateOnly(s) : '—');

export default function Approvals() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab = (TABS as readonly string[]).includes(params.tab || '') ? (params.tab as typeof TABS[number]) : 'Corrections';
  const [tab, setTab] = useState<typeof TABS[number]>(initialTab);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([
        api.get<Correction[]>('/attendance/corrections').catch(() => []),
        api.get<Leave[]>('/leaves').catch(() => []),
      ]);
      setCorrections(c); setLeaves(l);
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Times the approver applies to a correction (HH:MM) — start as what the employee asked for.
  const [times, setTimes] = useState<Record<string, { in: string; out: string }>>({});
  const timeFor = (c: Correction) => times[c.id] || { in: c.desired_check_in || '', out: c.desired_check_out || '' };
  const setTime = (c: Correction, k: 'in' | 'out', v: string) => setTimes((t) => ({ ...t, [c.id]: { ...timeFor(c), [k]: v } }));
  const inFlight = useRef<Set<string>>(new Set());
  const decide = async (kind: 'correction' | 'leave', id: string, action: 'approve' | 'reject', extra?: { check_in?: string; check_out?: string }) => {
    const key = `${kind}:${id}`;
    if (inFlight.current.has(key)) return; // guards rapid double/triple taps on Approve/Reject
    inFlight.current.add(key);
    try {
      const path = kind === 'correction' ? `/attendance/corrections/${id}/decide` : `/leaves/${id}/decide`;
      await api.post(path, { action, ...(extra || {}) });
      await load();
    } catch (e: any) {
      notify('Failed', e?.detail || 'Please try again');
    } finally {
      inFlight.current.delete(key);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="approvals-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Approvals</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.segRow}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            testID={`approvals-tab-${t.toLowerCase()}`}
            onPress={() => setTab(t)}
            style={[styles.segBtn, tab === t && styles.segBtnActive]}
          >
            <Text style={[styles.segText, tab === t && styles.segTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
          showsVerticalScrollIndicator={false}
        >
          {tab === 'Corrections' ? (
            corrections.length === 0 ? (
              <EmptyBox icon="checkmark-done-outline" text="No correction requests" />
            ) : corrections.map((c) => (
              <View key={c.id} style={styles.card} testID={`corr-${c.id}`}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.employee_name}</Text>
                    <Text style={styles.meta}>{c.employee_code} · {reasonLabel(c.reason_type)} · {fmtDate(c.date)}</Text>
                    {c.status === 'pending' ? (
                      // Editable: approving writes these onto the day (blank = keep what's there).
                      <View style={styles.desiredRow}>
                        {(['in', 'out'] as const).map((k) => (
                          <View key={k} style={styles.timeBox}>
                            <Ionicons name={k === 'in' ? 'log-in-outline' : 'log-out-outline'} size={13} color={colors.brandSecondary} />
                            <Text style={styles.desiredText}>{k === 'in' ? 'In' : 'Out'}</Text>
                            <TimeInput value={timeFor(c)[k]} onChangeText={(v) => setTime(c, k, v)} placeholder="HH:MM"
                              placeholderTextColor={colors.mutedText}
                              style={styles.timeInput} testID={`corr-${c.id}-${k}`} />
                          </View>
                        ))}
                      </View>
                    ) : (!!c.desired_check_in || !!c.desired_check_out) && (
                      <View style={styles.desiredRow}>
                        <View style={styles.desiredPill}>
                          <Ionicons name="log-in-outline" size={12} color={colors.brandSecondary} />
                          <Text style={styles.desiredText}>In {c.desired_check_in || '—'}</Text>
                        </View>
                        <View style={styles.desiredPill}>
                          <Ionicons name="log-out-outline" size={12} color={colors.brandSecondary} />
                          <Text style={styles.desiredText}>Out {c.desired_check_out || '—'}</Text>
                        </View>
                      </View>
                    )}
                    {!!c.note && <Text style={styles.note}>{c.note}</Text>}
                  </View>
                  <StatusChip s={c.status} />
                </View>
                {/* The day as it is vs. what approving makes it (or made it). */}
                {c.status === 'pending' ? (
                  <Compare left={viewOf(c.current)} right={projected(viewOf(c.current), timeFor(c), !!c.current)}
                    leftLabel="Current" rightLabel="After approval" testID={`corr-${c.id}-compare`} />
                ) : c.status === 'approved' && c.after ? (
                  <Compare left={viewOf(c.before)} right={viewOf(c.after)} leftLabel="Before" rightLabel="After" testID={`corr-${c.id}-compare`} />
                ) : null}
                {c.status === 'pending' && (
                  <DecideRow
                    onApprove={() => {
                      const t = timeFor(c);
                      const ok = (v: string) => !v.trim() || /^([01]?\d|2[0-3]):[0-5]\d$/.test(v.trim());
                      if (!ok(t.in) || !ok(t.out)) { notify('Check the time', 'Use 24-hour HH:MM, e.g. 10:15 or 19:30.'); return; }
                      decide('correction', c.id, 'approve', {
                        ...(t.in.trim() ? { check_in: t.in.trim() } : {}), ...(t.out.trim() ? { check_out: t.out.trim() } : {}),
                      });
                    }}
                    onReject={() => decide('correction', c.id, 'reject')}
                    testIDPrefix={`corr-${c.id}`}
                  />
                )}
              </View>
            ))
          ) : (
            leaves.length === 0 ? (
              <EmptyBox icon="calendar-outline" text="No leave requests" />
            ) : leaves.map((l) => (
              <View key={l.id} style={styles.card} testID={`leave-${l.id}`}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{l.employee_name}</Text>
                    <Text style={styles.meta}>{l.employee_code} · {l.leave_type.toUpperCase()} · {fmtDate(l.from_date)} → {fmtDate(l.to_date)}</Text>
                    {!!l.reason && <Text style={styles.note}>{l.reason}</Text>}
                  </View>
                  <StatusChip s={l.status} />
                </View>
                {l.status === 'pending' && (
                  <DecideRow
                    onApprove={() => decide('leave', l.id, 'approve')}
                    onReject={() => decide('leave', l.id, 'reject')}
                    testIDPrefix={`leave-${l.id}`}
                  />
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Compare({ left, right, leftLabel, rightLabel, testID }: { left: DayView; right: DayView; leftLabel: string; rightLabel: string; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const rows: [string, keyof DayView][] = [['In', 'in'], ['Out', 'out'], ['Hours', 'hours'], ['Status', 'status']];
  return (
    <View style={styles.cmp} testID={testID}>
      <View style={styles.cmpRow}>
        <Text style={[styles.cmpKey, styles.cmpHead]} />
        <Text style={[styles.cmpCell, styles.cmpHead]}>{leftLabel}</Text>
        <Text style={[styles.cmpCell, styles.cmpHead]}>{rightLabel}</Text>
      </View>
      {rows.map(([label, k]) => {
        const changed = left[k] !== right[k];
        return (
          <View key={k} style={styles.cmpRow}>
            <Text style={styles.cmpKey}>{label}</Text>
            <Text style={[styles.cmpCell, changed && left[k] !== '—' && styles.cmpOld]}>{left[k]}</Text>
            <Text style={[styles.cmpCell, changed && styles.cmpNew]}>{right[k]}</Text>
          </View>
        );
      })}
      {!!right.note && <Text style={styles.cmpNote}>{right.note}</Text>}
      {right.bad && <Text style={[styles.cmpNote, { color: colors.onError }]}>Check-out is before check-in — fix the Out time before approving.</Text>}
    </View>
  );
}

function DecideRow({ onApprove, onReject, testIDPrefix }: { onApprove: () => void; onReject: () => void; testIDPrefix: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.actions}>
      <Pressable style={[styles.actionBtn, styles.rejectBtn]} onPress={onReject} testID={`${testIDPrefix}-reject`}>
        <Ionicons name="close" size={16} color={colors.onError} />
        <Text style={[styles.actionText, { color: colors.onError }]}>Reject</Text>
      </Pressable>
      <Pressable style={[styles.actionBtn, styles.approveBtn]} onPress={onApprove} testID={`${testIDPrefix}-approve`}>
        <Ionicons name="checkmark" size={16} color={colors.onBrandPrimary} />
        <Text style={[styles.actionText, { color: colors.onBrandPrimary }]}>Approve</Text>
      </Pressable>
    </View>
  );
}

function StatusChip({ s }: { s: 'pending' | 'approved' | 'rejected' }) {
  const { colors } = useTheme();
  const chip = useMemo(() => makeChipStyles(colors), [colors]);
  const map = {
    pending: { label: 'Pending', bg: colors.warning, bd: colors.onWarning, fg: colors.onWarning },
    approved: { label: 'Approved', bg: colors.success, bd: colors.onSuccess, fg: colors.onSuccess },
    rejected: { label: 'Rejected', bg: colors.error, bd: colors.onError, fg: colors.onError },
  }[s];
  return (
    <View style={[chip.wrap, { backgroundColor: map.bg, borderColor: map.bd }]}>
      <Text style={[chip.text, { color: map.fg }]}>{map.label}</Text>
    </View>
  );
}

function EmptyBox({ icon, text }: { icon: any; text: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.mutedText} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const makeChipStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, borderWidth: 1 },
  text: { fontSize: 11, fontWeight: '700' },
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
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
    fontFamily: fonts.display,
  },
  segRow: {
    flexDirection: 'row', margin: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill, padding: 4, borderWidth: 1, borderColor: colors.border,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.pill },
  segBtnActive: { backgroundColor: colors.brandPrimary },
  segText: { color: colors.onSurfaceTertiary, fontWeight: '600', fontSize: 13 },
  segTextActive: { color: colors.onBrandPrimary },

  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm,
  },
  cardTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  name: { color: colors.onSurface, fontSize: 14, fontWeight: '700' },
  meta: { color: colors.onSurfaceTertiary, fontSize: 12, marginTop: 2 },
  note: { color: colors.mutedText, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  desiredRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 6 },
  desiredPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.brandTertiary,
    borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  cmp: { marginTop: spacing.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  cmpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  cmpHead: { color: colors.mutedText, fontSize: 10.5, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  cmpKey: { width: 64, color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  cmpCell: { flex: 1, color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  cmpOld: { color: colors.mutedText, textDecorationLine: 'line-through' },
  cmpNote: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '600', paddingHorizontal: 10, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  cmpNew: { color: colors.brandPrimary, fontWeight: '800' },
  timeBox: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  timeInput: { width: 58, paddingVertical: 5, paddingHorizontal: 4, color: colors.onSurface, fontSize: 13, fontWeight: '700' },
  desiredText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: {
    flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.md, paddingVertical: 10, borderWidth: 1,
  },
  approveBtn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  rejectBtn: { backgroundColor: colors.error, borderColor: colors.onError },
  actionText: { fontSize: 13, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary, fontSize: 13 },
});
