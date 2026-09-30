import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '@/src/api/client';
import { todayIST } from '@/src/utils/datetime';
import { spacing, radius, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { Sheet } from '@/src/components/ui';
import { StaffPerson } from './types';

type Day = { date: string; weekday: number; status: string };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inr = (n: number) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;

/** One person's month: today's punch, pay so far (Payroll access only), a calendar
 * coloured by status (from the same /attendance/calendar the Attendance screen uses)
 * and the month's totals. */
export function StaffSheet({ person, onClose, canSeePay }: { person: StaffPerson | null; onClose: () => void; canSeePay: boolean }) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const today = todayIST();
  const [ym, setYm] = useState(() => ({ y: +today.slice(0, 4), m: +today.slice(5, 7) }));
  const [days, setDays] = useState<Day[] | null>(null);
  const [earned, setEarned] = useState<number | null>(null);

  useEffect(() => { if (person) setYm({ y: +today.slice(0, 4), m: +today.slice(5, 7) }); }, [person?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!person) return;
    let alive = true;
    setDays(null);
    api.get<{ days: Day[] }>(`/attendance/calendar/${person.id}?year=${ym.y}&month=${ym.m}`)
      .then((r) => { if (alive) setDays(r.days); }).catch(() => { if (alive) setDays([]); });
    setEarned(null);
    if (canSeePay) {
      api.get<{ rows: { employee_id: string; earned: number }[] }>(`/payroll/${ym.y}/${ym.m}`)
        .then((r) => { if (alive) setEarned((r?.rows || []).find((x) => x.employee_id === person.id)?.earned ?? null); })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [person?.id, ym.y, ym.m, canSeePay]); // eslint-disable-line react-hooks/exhaustive-deps

  const shift = (d: number) => setYm((p) => {
    const m = p.m + d;
    return m < 1 ? { y: p.y - 1, m: 12 } : m > 12 ? { y: p.y + 1, m: 1 } : { y: p.y, m };
  });

  const tone: Record<string, { bg: string; dot: string } | undefined> = {
    present: { bg: colors.surfaceSecondary, dot: colors.onSuccess },
    half_day: { bg: colors.info, dot: colors.onInfo },
    absent: { bg: colors.error, dot: colors.onError },
    missing_punch: { bg: colors.warning, dot: colors.onWarning },
    leave: { bg: colors.warning, dot: colors.onWarning },
    holiday: { bg: 'transparent', dot: colors.mutedText },
    weekly_off: { bg: 'transparent', dot: colors.mutedText },
  };
  const counts = { present: 0, absent: 0, leave: 0, half_day: 0 } as Record<string, number>;
  (days || []).forEach((d) => { if (d.date <= today && d.status in counts) counts[d.status] += 1; });
  const lead = days && days.length ? (days[0].weekday + 1) % 7 : 0;   // Sunday-first grid (API weekday: 0 = Mon)

  if (!person) return null;
  const statusText = person.status === 'late' ? `Late ${person.late_min} min`
    : person.status === 'present' ? 'On time'
      : person.status === 'leave' ? 'On leave'
        : person.status === 'absent' ? 'Absent' : 'Not in yet';
  const statusColor = person.status === 'present' ? colors.onSuccess : person.status === 'late' ? colors.onWarning
    : person.status === 'leave' ? colors.mutedText : colors.onError;

  return (
    <Sheet visible={!!person} onClose={onClose} testID="staff-sheet">
      <View style={s.head}>
        {person.photo ? <Image source={{ uri: person.photo }} style={s.av} /> : (
          <View style={[s.av, s.avEmpty]}><Text style={s.avText}>{person.name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</Text></View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name} numberOfLines={1}>{person.name}</Text>
          <Text style={s.meta} numberOfLines={1}>{[person.role, person.department].filter(Boolean).join(' · ') || 'Staff'}</Text>
        </View>
      </View>

      <View style={s.todayRow}>
        <View style={s.todayCell}><Text style={s.todayLbl}>In today</Text><Text style={s.todayVal}>{person.check_in || '—'}</Text></View>
        <View style={s.todayCell}><Text style={s.todayLbl}>Status</Text><Text style={[s.todayVal, { color: statusColor }]}>{statusText}</Text></View>
        {canSeePay && (
          <View style={s.todayCell}><Text style={s.todayLbl}>This month</Text><Text style={s.todayVal}>{earned == null ? '—' : inr(earned)}</Text></View>
        )}
      </View>

      <View style={s.calHead}>
        <Text style={s.calTitle}>{MONTHS[ym.m - 1]} {ym.y}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Pressable onPress={() => shift(-1)} style={s.navBtn} accessibilityLabel="Previous month" testID="staff-prev-month"><Ionicons name="chevron-back" size={16} color={colors.onSurface} /></Pressable>
          <Pressable onPress={() => shift(1)} style={s.navBtn} accessibilityLabel="Next month" testID="staff-next-month"><Ionicons name="chevron-forward" size={16} color={colors.onSurface} /></Pressable>
        </View>
      </View>
      {!days ? <ActivityIndicator color={colors.brandPrimary} style={{ marginVertical: 40 }} /> : (
        <View style={s.grid} testID="staff-calendar">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={s.wd}>{w}</Text>)}
          {Array.from({ length: lead }).map((_, i) => <View key={`e${i}`} style={s.cell} />)}
          {days.map((d) => {
            const future = d.date > today;
            const t = future ? undefined : tone[d.status];
            return (
              <View key={d.date} style={[s.cell, s.day, { backgroundColor: t?.bg ?? 'transparent' }, d.date === today && s.today]}>
                <Text style={[s.dayNum, (future || d.status === 'weekly_off' || d.status === 'holiday') && { color: colors.mutedText }]}>{+d.date.slice(8)}</Text>
                {t && d.status !== 'weekly_off' && d.status !== 'holiday' && <View style={[s.dot, { backgroundColor: t.dot }]} />}
              </View>
            );
          })}
        </View>
      )}
      <View style={s.legend}>
        {[['Present', colors.onSuccess], ['Absent', colors.onError], ['Leave', colors.onWarning], ['Half day', colors.onInfo]].map(([l, c]) => (
          <View key={l} style={s.legendItem}><View style={[s.dot, { backgroundColor: c, marginTop: 0 }]} /><Text style={s.legendText}>{l}</Text></View>
        ))}
      </View>
      <View style={s.totals}>
        {[['Present', counts.present], ['Absent', counts.absent], ['Leave', counts.leave], ['Half', counts.half_day]].map(([l, n]) => (
          <View key={l as string} style={s.total}><Text style={s.totalNum}>{n}</Text><Text style={s.totalLbl}>{l}</Text></View>
        ))}
      </View>
      <View style={s.btns}>
        <Pressable onPress={() => { onClose(); router.push(`/attendance/calendar/${person.id}` as any); }} style={s.btn} testID="staff-edit-day">
          <Text style={s.btnText}>Edit a day</Text>
        </Pressable>
        {canSeePay && (
          <Pressable onPress={() => { onClose(); router.push(`/ledger/new?emp=${person.id}&type=advance` as any); }} style={s.btn} testID="staff-give-advance">
            <Text style={s.btnText}>Give advance</Text>
          </Pressable>
        )}
      </View>
    </Sheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  av: { width: 46, height: 46, borderRadius: 23 },
  avEmpty: { backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  avText: { color: colors.onSurfaceSecondary, fontWeight: '700' },
  name: { color: colors.onSurface, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  meta: { color: colors.mutedText, fontSize: 13, marginTop: 1 },
  todayRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  todayCell: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: 11, paddingVertical: 9 },
  todayLbl: { color: colors.mutedText, fontSize: 12 },
  todayVal: { color: colors.onSurface, fontSize: 15, fontWeight: '700', marginTop: 1 },
  calHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  calTitle: { color: colors.onSurface, fontSize: 16, fontWeight: '700' },
  navBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  wd: { width: `${100 / 7}%`, textAlign: 'center', color: colors.mutedText, fontSize: 11, fontWeight: '600', paddingBottom: 4 },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, padding: 2 },
  day: { borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  today: { borderColor: colors.brandPrimary },
  dayNum: { color: colors.onSurface, fontSize: 13, fontWeight: '600' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { color: colors.mutedText, fontSize: 11.5 },
  totals: { flexDirection: 'row', gap: 6, marginTop: spacing.md },
  total: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 8, alignItems: 'center' },
  totalNum: { color: colors.onSurface, fontSize: 17, fontWeight: '800' },
  totalLbl: { color: colors.mutedText, fontSize: 11 },
  btns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
});
