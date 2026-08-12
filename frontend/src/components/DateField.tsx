import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A pressable field that opens a small calendar modal instead of a free-text
 * date input — tap a day, it fills in as YYYY-MM-DD and closes. No native
 * dependency, works the same on web and native.
 */
export function DateField({ label, value, onChange, placeholder = 'Select a date', testID }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const base = value ? new Date(value + 'T00:00:00') : new Date();
  const [viewYear, setViewYear] = useState(base.getFullYear());
  const [viewMonth, setViewMonth] = useState(base.getMonth());

  const openPicker = () => {
    const b = value ? new Date(value + 'T00:00:00') : new Date();
    setViewYear(b.getFullYear()); setViewMonth(b.getMonth());
    setOpen(true);
  };

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday=0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const pick = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    onChange(toISO(d));
    setOpen(false);
  };

  const todayISO = toISO(new Date());

  return (
    <>
      {label && <Text style={styles.label}>{label}</Text>}
      <Pressable onPress={openPicker} style={styles.field} testID={testID}>
        <Ionicons name="calendar-outline" size={16} color={colors.mutedText} />
        <Text style={value ? styles.value : styles.placeholder}>{value || placeholder}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.calHeader}>
              <Pressable onPress={() => { if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); } else setViewMonth((m) => m - 1); }} hitSlop={10} testID="date-prev-month">
                <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.calTitle}>{MONTHS[viewMonth]} {viewYear}</Text>
              <Pressable onPress={() => { if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); } else setViewMonth((m) => m + 1); }} hitSlop={10} testID="date-next-month">
                <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
              </Pressable>
            </View>
            <View style={styles.weekRow}>
              {WEEK_LABELS.map((w, i) => <Text key={i} style={styles.weekLabel}>{w}</Text>)}
            </View>
            <View style={styles.grid}>
              {cells.map((day, i) => {
                if (day == null) return <View key={i} style={styles.cell} />;
                const iso = toISO(new Date(viewYear, viewMonth, day));
                const isSelected = iso === value;
                const isToday = iso === todayISO;
                return (
                  <Pressable key={i} onPress={() => pick(day)} style={styles.cell} testID={`date-day-${iso}`}>
                    <View style={[styles.dayCircle, isSelected && styles.dayCircleSelected, !isSelected && isToday && styles.dayCircleToday]}>
                      <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>{day}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => { onChange(todayISO); setOpen(false); }} style={styles.todayBtn} testID="date-today-btn">
              <Text style={styles.todayBtnText}>Today</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, marginTop: spacing.sm },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: spacing.md, paddingVertical: 12,
  },
  value: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  placeholder: { color: colors.mutedText, fontSize: 14 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: { width: 320, maxWidth: '100%', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  calTitle: { color: colors.onSurface, fontSize: 15, fontWeight: '700', fontFamily: fonts.display },
  weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
  weekLabel: { flex: 1, textAlign: 'center', color: colors.mutedText, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  dayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  dayCircleSelected: { backgroundColor: colors.brandPrimary },
  dayCircleToday: { borderWidth: 1, borderColor: colors.brand },
  dayText: { color: colors.onSurface, fontSize: 13 },
  dayTextSelected: { color: colors.onBrandPrimary, fontWeight: '700' },
  todayBtn: { alignItems: 'center', paddingVertical: 10, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  todayBtnText: { color: colors.brandSecondary, fontWeight: '700', fontSize: 13 },
});
