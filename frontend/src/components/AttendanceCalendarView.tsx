import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { notify } from '@/src/utils/notify';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { confirmAction } from '@/src/utils/confirm';
import { istTime, displayDateOnly, displayDateOnlyWithWeekday } from '@/src/utils/datetime';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type Day = {
  date: string; weekday: number; status: string; is_sunday: boolean;
  holiday_name: string | null; check_in: string | null; check_out: string | null;
  is_late: boolean; working_hours: number; via_correction: boolean; has_record: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

type StatusStyle = { bg: string; fg: string };

// Full-cell fill + accent color per attendance status. Every status gets its
// own genuinely distinct hue — they used to double up (half_day reused the
// same amber as late, missing_punch reused the same red as absent, and
// weekly_off's gold nearly matched warning-amber), which made cells that mean
// very different things for payroll look identical at a glance. Custom hex
// pairs (not theme semantic tokens) are used for the statuses beyond the
// core 4 (success/warning/error/info) since this palette only has those four
// plus neutral/brand to work with.
function makeStatusStyles(colors: ThemeColors, scheme: 'light' | 'dark'): Record<string, StatusStyle> {
  const light = scheme === 'light';
  return {
    present: { bg: colors.success, fg: colors.onSuccess },                                   // green
    late: { bg: colors.warning, fg: colors.onWarning },                                       // amber/gold
    half_day: light ? { bg: '#F0E4F7', fg: '#7A3E96' } : { bg: '#3A1F45', fg: '#D9A8E8' },     // purple
    absent: { bg: colors.error, fg: colors.onError },                                          // red
    missing_punch: light ? { bg: '#FCE4EF', fg: '#A32468' } : { bg: '#4A1330', fg: '#F2A0C7' }, // pink/magenta
    leave: { bg: colors.info, fg: colors.onInfo },                                              // blue
    holiday: { bg: colors.surfaceTertiary, fg: colors.mutedText },                              // neutral grey
    weekly_off: light ? { bg: '#E1EFEA', fg: '#2F7A62' } : { bg: '#163A32', fg: '#7FD9BC' },     // teal
  };
}

type Shift = { id: string; name: string; start: string; end: string; grace_min: number; late_half_day_after_min?: number | null };

/**
 * Shared calendar UI used both by the admin/owner drill-down route
 * (`app/attendance/calendar/[id].tsx`) and the employee's own "Calendar" tab
 * (`app/(emp)/calendar.tsx`). Pass `onBack` to render a back/close header —
 * omit it when embedding inline in a tab (no navigation chrome needed).
 */
export default function AttendanceCalendarView({ empId, onBack, title = 'Calendar' }: {
  empId: string; onBack?: () => void; title?: string;
}) {
  const { user } = useAuth();
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const statusStyles = useMemo(() => makeStatusStyles(colors, scheme), [colors, scheme]);
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<{ days: Day[] } | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Day | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ days: Day[] }>(`/attendance/calendar/${empId}?year=${year}&month=${month}`);
      setData(res);
    } catch (_e) { setData(null); }
    finally { setLoading(false); }
  }, [empId, year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));
  useFocusEffect(useCallback(() => { api.get<Shift[]>('/shifts').then(setShifts).catch(() => {}); }, []));

  const stepMonth = (d: number) => {
    let m = month + d, y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m); setYear(y);
  };

  // Build week grid — pad leading empty cells based on first day's weekday (0=Mon)
  const days = data?.days || [];
  const cells: (Day | null)[] = [];
  if (days.length > 0) {
    const first = days[0];
    for (let i = 0; i < first.weekday; i++) cells.push(null);
    cells.push(...days);
  }

  return (
    <View style={styles.root} testID="calendar-screen">
      {onBack && (
        <View style={styles.header}>
          <Pressable onPress={onBack} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
            <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      <View style={styles.monthRow}>
        <Pressable onPress={() => stepMonth(-1)} style={styles.monthNav} testID="cal-prev">
          <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.monthLabel}>{MONTHS[month - 1]} {year}</Text>
        <Pressable onPress={() => stepMonth(1)} style={styles.monthNav} testID="cal-next">
          <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brandPrimary} size="large" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} showsVerticalScrollIndicator={false}>
          {days.length > 0 && (() => {
            const c = { present: 0, late: 0, half: 0, absent: 0, leave: 0, off: 0 };
            for (const d of days) {
              if (d.status === 'present') { c.present += 1; if (d.is_late) c.late += 1; }
              else if (d.status === 'half_day') c.half += 1;
              else if (d.status === 'absent') c.absent += 1;
              else if (d.status === 'leave') c.leave += 1;
              else if (d.status === 'holiday' || d.status === 'weekly_off') c.off += 1;
            }
            const cell = (v: number, label: string, color: string) => (
              <View style={styles.sumCell}><Text style={[styles.sumVal, { color }]}>{v}</Text><Text style={styles.sumLbl}>{label}</Text></View>
            );
            return (
              <View style={styles.monthSummary} testID="calendar-month-summary">
                {cell(c.present, 'Present', colors.onSuccess)}
                {cell(c.late, 'Late', colors.onWarning)}
                {cell(c.half, 'Half', colors.onWarning)}
                {cell(c.absent, 'Absent', colors.onError)}
                {cell(c.leave, 'Leave', colors.brandSecondary)}
                {cell(c.off, 'Off', colors.mutedText)}
              </View>
            );
          })()}
          <View style={styles.weekRow}>
            {WEEK_LABELS.map((w, i) => (
              <Text key={i} style={[styles.weekLabel, i === 6 && { color: colors.onError }]}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((c, idx) => {
              if (!c) return <View key={`e${idx}`} style={styles.cell} />;
              // Only fall back to the "late" swatch when the day is otherwise a plain
              // present day — half_day/absent/leave/etc. all carry more specific meaning
              // than lateness and should win. Previously `is_late` short-circuited this
              // for every status (half_day days are almost always also is_late), so a
              // late-triggered half-day always rendered as plain "Late", never "Half Day".
              const statusKey = (c.status === 'present' && c.is_late) ? 'late' : c.status;
              const st = statusStyles[statusKey] || { bg: colors.surfaceSecondary, fg: colors.mutedText };
              return (
                <Pressable
                  key={c.date}
                  style={[styles.cell, styles.cellFilled]}
                  onPress={() => setSelected(c)}
                  testID={`cal-day-${c.date}`}
                >
                  <View style={[styles.dayCell, { backgroundColor: st.bg, borderColor: st.fg }]}>
                    <Text style={[styles.dayNum, { color: st.fg }]}>{parseInt(c.date.slice(-2), 10)}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.legend}>
            {[
              { k: 'present', label: 'Present' },
              { k: 'late', label: 'Late' },
              { k: 'half_day', label: 'Half Day' },
              { k: 'absent', label: 'Absent' },
              { k: 'missing_punch', label: 'Missing Punch' },
              { k: 'leave', label: 'Leave' },
              { k: 'holiday', label: 'Holiday' },
              { k: 'weekly_off', label: 'Paid Off' },
            ].map((l) => (
              <View key={l.k} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: statusStyles[l.k].bg, borderColor: statusStyles[l.k].fg }]} />
                <Text style={styles.legendText}>{l.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {selected && (
        <DayDetail
          day={selected}
          empId={empId}
          canEdit={!!canEdit}
          shifts={shifts}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load(); }}
        />
      )}
    </View>
  );
}

const OFF_STATUSES = ['absent', 'leave', 'weekly_off'] as const;

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function DayDetail({ day, empId, canEdit, shifts, onClose, onSaved }: {
  day: Day; empId: string; canEdit: boolean; shifts: Shift[];
  onClose: () => void; onSaved: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [inTime, setInTime] = useState(day.check_in ? istTime(day.check_in) : '');
  const [outTime, setOutTime] = useState(day.check_out ? istTime(day.check_out) : '');
  const initialOff = OFF_STATUSES.includes(day.status as any) ? (day.status as typeof OFF_STATUSES[number]) : null;
  const [offStatus, setOffStatus] = useState<typeof OFF_STATUSES[number] | null>(initialOff);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const submittingRef = useRef(false);

  // Live preview of what the times will resolve to — mirrors the backend's auto-calc
  // so the owner sees the result before saving instead of having to guess a status.
  const preview = useMemo(() => {
    if (offStatus) return null;
    const inM = toMinutes(inTime), outM = toMinutes(outTime);
    if (inM === null || outM === null) return null;
    let hours = (outM - inM) / 60;
    if (hours < 0) hours += 24;
    hours = Math.round(hours * 100) / 100;
    const graceMin = selectedShift?.grace_min ?? 15;
    const shiftStartM = selectedShift ? toMinutes(selectedShift.start) : null;
    const lateByMin = shiftStartM !== null ? inM - (shiftStartM! + graceMin) : 0;
    const isLate = lateByMin > 0;
    const lateThreshold = selectedShift?.late_half_day_after_min ?? null;
    const halfDayForLateness = !!lateThreshold && lateByMin >= lateThreshold;
    return {
      hours,
      status: (hours < 4 || halfDayForLateness) ? 'half_day' : 'present',
      isLate,
      halfDayForLateness,
    };
  }, [inTime, outTime, offStatus, selectedShift]);

  const applyShift = (s: Shift) => {
    setOffStatus(null);
    setSelectedShift(s);
    setInTime(s.start);
    setOutTime(s.end);
  };

  const save = async () => {
    if (submittingRef.current) return; // guards rapid double/triple taps before re-render
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.put(`/attendance/day/${empId}/${day.date}`, {
        status: offStatus || 'present',
        check_in_time: offStatus ? null : (inTime || null),
        check_out_time: offStatus ? null : (outTime || null),
      });
      onSaved();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  const confirmDelete = () => {
    confirmAction(
      'Delete entry?',
      `This removes the attendance record for ${displayDateOnly(day.date)}. This cannot be undone.`,
      'Delete',
      doDelete,
    );
  };

  const doDelete = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setDeleting(true);
    try {
      await api.del(`/attendance/day/${empId}/${day.date}`);
      onSaved();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setDeleting(false); submittingRef.current = false; }
  };

  const requestChange = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    try {
      await api.post('/attendance/corrections/calendar', {
        date: day.date, desired_check_in: inTime || null, desired_check_out: outTime || null,
        reason_type: 'other', note: 'Requested from calendar',
      });
      onSaved();
    } catch (e: any) { notify('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); submittingRef.current = false; }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBg}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: 36 }} testID="day-detail-sheet" keyboardShouldPersistTaps="handled">
          <View style={styles.sheetGrip} />
          <View style={styles.sheetTitleRow}>
            <Text style={styles.sheetTitle}>{displayDateOnlyWithWeekday(day.date)}</Text>
            {canEdit && day.has_record && (
              <Pressable
                onPress={confirmDelete}
                disabled={deleting}
                style={[styles.deleteIconBtn, deleting && { opacity: 0.5 }]}
                testID="day-delete-btn"
                hitSlop={10}
              >
                {deleting ? <ActivityIndicator size="small" color={colors.onError} /> : <Ionicons name="trash-outline" size={18} color={colors.onError} />}
              </Pressable>
            )}
          </View>
          {day.holiday_name && <Text style={styles.sheetSub}>Holiday: {day.holiday_name}</Text>}
          {day.is_sunday && <Text style={styles.sheetSub}>Sunday</Text>}

          {canEdit && shifts.length > 0 && (
            <>
              <Text style={styles.timeLabel}>Quick fill from shift</Text>
              <View style={styles.shiftRow}>
                {shifts.map((s) => (
                  <Pressable
                    key={s.id}
                    testID={`day-shift-${s.id}`}
                    onPress={() => applyShift(s)}
                    style={[styles.shiftChip, selectedShift?.id === s.id && styles.shiftChipActive]}
                  >
                    <Text style={[styles.shiftChipText, selectedShift?.id === s.id && styles.shiftChipTextActive]}>{s.name}</Text>
                    <Text style={[styles.shiftChipTime, selectedShift?.id === s.id && styles.shiftChipTextActive]}>{s.start}–{s.end}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.timeLabel}>Check-In</Text>
              <TextInput
                testID="day-in-time"
                value={inTime} onChangeText={(v) => { setInTime(v); setOffStatus(null); }}
                editable
                placeholder="HH:MM" placeholderTextColor={colors.mutedText}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                style={styles.timeInput} autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timeLabel}>Check-Out</Text>
              <TextInput
                testID="day-out-time"
                value={outTime} onChangeText={(v) => { setOutTime(v); setOffStatus(null); }}
                editable
                placeholder="HH:MM" placeholderTextColor={colors.mutedText}
                keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                style={styles.timeInput} autoCapitalize="none"
              />
            </View>
          </View>

          {preview && (
            <View style={styles.previewBox} testID="day-preview">
              <Ionicons name="calculator-outline" size={14} color={colors.brandSecondary} />
              <Text style={styles.previewText}>
                Auto: {preview.hours}h → {preview.status === 'present' ? 'Present' : 'Half Day'}
                {preview.isLate ? ' · Late' : ''}
                {preview.halfDayForLateness ? ' (late master)' : ''}
              </Text>
            </View>
          )}

          {canEdit && (
            <>
              <Text style={styles.timeLabel}>Or mark day as</Text>
              <View style={styles.statusRow}>
                {(['absent', 'leave', 'weekly_off'] as const).map((s) => (
                  <Pressable
                    key={s}
                    testID={`day-status-${s}`}
                    onPress={() => { setOffStatus(s); setInTime(''); setOutTime(''); }}
                    style={[styles.statusBtn, offStatus === s && styles.statusBtnActive]}
                  >
                    <Text style={[styles.statusText, offStatus === s && styles.statusTextActive]}>
                      {s === 'weekly_off' ? 'PAID OFF' : s.toUpperCase()}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hintText}>&quot;Paid Off&quot; is for weekly-offs / comp-offs — paid without a punch, just like Sunday.</Text>
            </>
          )}

          <Text style={styles.hourText}>{day.working_hours ? `${day.working_hours}h worked` : 'No punch recorded'}</Text>

          <View style={styles.sheetActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose} testID="day-cancel-btn">
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
            {canEdit ? (
              <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} testID="day-save-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
              </Pressable>
            ) : (
              <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={requestChange} disabled={saving} testID="day-request-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Request Change</Text>}
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

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
  monthRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: 6,
  },
  monthNav: {
    width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  monthLabel: { flex: 1, textAlign: 'center', color: colors.onSurface, fontWeight: '700', fontSize: 15 },

  monthSummary: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, marginBottom: spacing.md },
  sumCell: { flex: 1, alignItems: 'center' },
  sumVal: { fontSize: 16, fontWeight: '800' },
  sumLbl: { color: colors.mutedText, fontSize: 10, marginTop: 2 },
  weekRow: { flexDirection: 'row', marginBottom: spacing.sm },
  weekLabel: { flex: 1, textAlign: 'center', color: colors.mutedText, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.285%', aspectRatio: 1, padding: 3 },
  cellFilled: {
    justifyContent: 'flex-start', alignItems: 'center',
  },
  dayCell: {
    width: '100%', height: '100%', borderRadius: radius.sm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  dayNum: { fontSize: 13, fontWeight: '700' },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg },
  legendItem: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  legendDot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1.5 },
  legendText: { color: colors.onSurfaceTertiary, fontSize: 11 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderColor: colors.brand, borderTopWidth: 1, padding: spacing.lg, paddingBottom: 36,
  },
  shiftRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  shiftChip: {
    paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border,
  },
  shiftChipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  shiftChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: '700' },
  shiftChipTime: { color: colors.mutedText, fontSize: 10, marginTop: 1 },
  shiftChipTextActive: { color: colors.onBrandPrimary },
  previewBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm,
    backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  previewText: { color: colors.brandSecondary, fontSize: 11, fontWeight: '700' },
  hintText: { color: colors.mutedText, fontSize: 10, marginTop: 6 },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700', flex: 1 },
  deleteIconBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.error, borderWidth: 1, borderColor: colors.border,
  },
  sheetSub: { color: colors.brandSecondary, fontSize: 12, marginTop: 2 },
  timeRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  timeLabel: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  timeInput: {
    backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md,
    paddingVertical: 12, fontSize: 14,
  },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statusBtn: { flex: 1, minWidth: 70, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  statusBtnActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  statusText: { color: colors.onSurfaceTertiary, fontSize: 10, fontWeight: '700' },
  statusTextActive: { color: colors.onBrandPrimary },
  hourText: { color: colors.mutedText, fontSize: 12, marginTop: spacing.md },
  sheetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surfaceTertiary },
  cancelText: { color: colors.onSurfaceSecondary, fontWeight: '700' },
  saveBtn: { flex: 1.5, paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.brandPrimary, alignItems: 'center' },
  saveText: { color: colors.onBrandPrimary, fontWeight: '800' },
});
