import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Modal, TextInput, Alert, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthContext';
import { colors, spacing, radius } from '@/src/theme';

type Day = {
  date: string; weekday: number; status: string; is_sunday: boolean;
  holiday_name: string | null; check_in: string | null; check_out: string | null;
  is_late: boolean; working_hours: number; via_correction: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const STATUS_COLORS: Record<string, string> = {
  present: '#B7EFC5', absent: '#F1A9A9', late: '#F1D890', half_day: '#F1D890',
  leave: '#8AB6D6', holiday: '#C2C2C2', missing_punch: '#F1A9A9',
};

const fmtHM = (iso?: string | null) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};

export default function AttendanceCalendar() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const canEdit = user?.role === 'owner' || user?.role === 'admin';
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<{ days: Day[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Day | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ days: Day[] }>(`/attendance/calendar/${id}?year=${year}&month=${month}`);
      setData(res);
    } catch (_e) { setData(null); }
    finally { setLoading(false); }
  }, [id, year, month]);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

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
    <SafeAreaView style={styles.root} edges={['top']} testID="calendar-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Calendar</Text>
        <View style={{ width: 40 }} />
      </View>

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
          <View style={styles.weekRow}>
            {WEEK_LABELS.map((w, i) => (
              <Text key={i} style={[styles.weekLabel, i === 6 && { color: '#F1A9A9' }]}>{w}</Text>
            ))}
          </View>

          <View style={styles.grid}>
            {cells.map((c, idx) => {
              if (!c) return <View key={`e${idx}`} style={styles.cell} />;
              const color = STATUS_COLORS[c.is_late ? 'late' : c.status] || colors.mutedText;
              return (
                <Pressable
                  key={c.date}
                  style={[styles.cell, styles.cellFilled]}
                  onPress={() => setSelected(c)}
                  testID={`cal-day-${c.date}`}
                >
                  <Text style={styles.dayNum}>{parseInt(c.date.slice(-2), 10)}</Text>
                  <View style={[styles.statusDot, { backgroundColor: color }]} />
                </Pressable>
              );
            })}
          </View>

          <View style={styles.legend}>
            {[
              { k: 'present', label: 'Present' },
              { k: 'late', label: 'Late/Half' },
              { k: 'absent', label: 'Absent' },
              { k: 'leave', label: 'Leave' },
              { k: 'holiday', label: 'Holiday' },
            ].map((l) => (
              <View key={l.k} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS[l.k] }]} />
                <Text style={styles.legendText}>{l.label}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {selected && (
        <DayDetail
          day={selected}
          empId={id!}
          canEdit={!!canEdit}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); load(); }}
        />
      )}
    </SafeAreaView>
  );
}

function DayDetail({ day, empId, canEdit, onClose, onSaved }: {
  day: Day; empId: string; canEdit: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const [inTime, setInTime] = useState(day.check_in ? new Date(day.check_in).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  const [outTime, setOutTime] = useState(day.check_out ? new Date(day.check_out).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
  const [status, setStatus] = useState<Day['status']>(day.status === 'missing_punch' ? 'present' : day.status);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/attendance/day/${empId}/${day.date}`, {
        status, check_in_time: inTime || null, check_out_time: outTime || null,
      });
      onSaved();
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  const requestChange = async () => {
    setSaving(true);
    try {
      await api.post('/attendance/corrections/calendar', {
        date: day.date, desired_check_in: inTime || null, desired_check_out: outTime || null,
        reason_type: 'other', note: 'Requested from calendar',
      });
      Alert.alert('Sent', 'Change request sent to owner.', [{ text: 'OK', onPress: onSaved }]);
    } catch (e: any) { Alert.alert('Failed', e?.detail || 'Please try again'); }
    finally { setSaving(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBg}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={styles.sheet} testID="day-detail-sheet">
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetTitle}>{new Date(day.date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          {day.holiday_name && <Text style={styles.sheetSub}>Holiday: {day.holiday_name}</Text>}
          {day.is_sunday && <Text style={styles.sheetSub}>Sunday</Text>}

          <View style={styles.timeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.timeLabel}>Check-In</Text>
              <TextInput
                testID="day-in-time"
                value={inTime} onChangeText={setInTime}
                editable={canEdit || !day.check_in}
                placeholder="HH:MM" placeholderTextColor={colors.mutedText}
                style={styles.timeInput} autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timeLabel}>Check-Out</Text>
              <TextInput
                testID="day-out-time"
                value={outTime} onChangeText={setOutTime}
                editable={canEdit || !day.check_out}
                placeholder="HH:MM" placeholderTextColor={colors.mutedText}
                style={styles.timeInput} autoCapitalize="none"
              />
            </View>
          </View>

          {canEdit && (
            <>
              <Text style={styles.timeLabel}>Status</Text>
              <View style={styles.statusRow}>
                {(['present', 'half_day', 'absent', 'leave'] as const).map((s) => (
                  <Pressable
                    key={s}
                    testID={`day-status-${s}`}
                    onPress={() => setStatus(s)}
                    style={[styles.statusBtn, status === s && styles.statusBtnActive]}
                  >
                    <Text style={[styles.statusText, status === s && styles.statusTextActive]}>{s.replace('_', ' ').toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <Text style={styles.hourText}>{day.working_hours ? `${day.working_hours}h worked` : 'No punch recorded'}</Text>

          <View style={styles.sheetActions}>
            <Pressable style={styles.cancelBtn} onPress={onClose} testID="day-cancel-btn">
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
            {canEdit ? (
              <Pressable style={styles.saveBtn} onPress={save} disabled={saving} testID="day-save-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Save</Text>}
              </Pressable>
            ) : (
              <Pressable style={styles.saveBtn} onPress={requestChange} disabled={saving} testID="day-request-btn">
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>Request Change</Text>}
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
    fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }),
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

  weekRow: { flexDirection: 'row', marginBottom: spacing.sm },
  weekLabel: { flex: 1, textAlign: 'center', color: colors.mutedText, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '14.285%', aspectRatio: 1, padding: 3 },
  cellFilled: {
    justifyContent: 'flex-start', alignItems: 'center',
  },
  dayNum: {
    color: colors.onSurface, fontSize: 13, fontWeight: '600',
    backgroundColor: colors.surfaceSecondary, borderColor: colors.border, borderWidth: 1,
    width: '100%', height: '75%', borderRadius: radius.sm, textAlign: 'center', textAlignVertical: 'center', paddingTop: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 3 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg },
  legendItem: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: colors.onSurfaceTertiary, fontSize: 11 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    borderColor: colors.brand, borderTopWidth: 1, padding: spacing.lg, paddingBottom: 36,
  },
  sheetGrip: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontSize: 18, fontWeight: '700' },
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
