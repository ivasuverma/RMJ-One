import { ReactNode, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// Every master/screen that feeds attendance or payroll calculations, gathered
// in one place instead of scattered across People & Access / Masters /
// Business (utility.tsx) — same grouped iOS-style inset list as that screen.
type RowDef = { key: string; label: string; sub: string; icon: keyof typeof Ionicons.glyphMap; route: string };
type GroupDef = { title: string; rows: RowDef[] };

const GROUPS: GroupDef[] = [
  {
    title: 'Masters',
    rows: [
      { key: 'departments', label: 'Departments', sub: 'Who works where', icon: 'business-outline', route: '/settings/departments' },
      { key: 'locations', label: 'Locations / Branches', sub: 'Shop sites', icon: 'location-outline', route: '/settings/locations' },
      { key: 'shifts', label: 'Shifts', sub: 'Work timings', icon: 'time-outline', route: '/settings/shifts' },
      { key: 'holidays', label: 'Holidays', sub: 'Holiday calendar', icon: 'calendar-outline', route: '/settings/holidays' },
    ],
  },
  {
    title: 'Hardware & Store',
    rows: [
      { key: 'biometric', label: 'Biometric Devices', sub: 'Attendance hardware', icon: 'hardware-chip-outline', route: '/settings/biometric' },
      { key: 'store', label: 'Store Settings', sub: 'Shop profile & hours', icon: 'storefront-outline', route: '/store-settings' },
      { key: 'whatsapp', label: 'WhatsApp', sub: 'Connection status & notice toggles', icon: 'logo-whatsapp', route: '/settings/whatsapp' },
    ],
  },
];

export default function AttendancePayrollScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="attendance-payroll-screen">
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>Attendance &amp; Payroll</Text>
        <View style={styles.iconBtn} />
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {GROUPS.map((g) => (
          <View key={g.title}>
            <Text style={styles.groupTitle}>{g.title}</Text>
            {g.rows.map((r) => (
              <Row key={r.key} icon={r.icon} label={r.label} sub={r.sub} onPress={() => router.push(r.route as any)} testID={`ap-row-${r.key}`} />
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, sub, trailing, onPress, testID }: {
  icon: keyof typeof Ionicons.glyphMap; label: string; sub?: string; trailing?: ReactNode; onPress: () => void; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]} testID={testID}>
      <View style={styles.rowIcon}><Ionicons name={icon} size={22} color={colors.brandSecondary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
        {!!sub && <Text style={styles.rowSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {trailing}
      <Ionicons name="chevron-forward" size={18} color={colors.mutedText} style={{ marginLeft: 6 }} />
    </Pressable>
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
  title: { flex: 1, color: colors.onSurface, fontSize: 20, fontWeight: '600', fontFamily: fonts.display, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  groupTitle: {
    color: colors.mutedText, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase',
    fontWeight: '700', marginBottom: spacing.md, marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.sm,
  },
  rowIcon: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { color: colors.onSurface, fontSize: 17, fontWeight: '600' },
  rowSub: { color: colors.mutedText, fontSize: 13.5, marginTop: 3 },
});
