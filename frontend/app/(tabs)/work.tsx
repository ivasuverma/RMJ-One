import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// The single operational hub for the main app — everything you *do* lives
// here, grouped by the kind of work rather than by which old tab it used to
// be under. This replaces the former separate Transactions and Reports tabs
// (Phase 2 of the v2 rebuild). Each tile is gated on the caller's resolved
// module set, so an accountant sees a cash/ledger-weighted Work and an
// employee only sees what they were granted. The deeper redesign of each
// area (repairs pipeline, ledger, combined payroll+attendance) lands in
// later phases; this phase just collapses the navigation to three tabs.
type TileDef = {
  key: string; label: string; icon: keyof typeof Ionicons.glyphMap;
  route: string;
  // Show the tile when ANY of these modules is present. Empty = always show.
  modules?: string[];
};

type SectionDef = { title: string; tiles: TileDef[] };

const SECTIONS: SectionDef[] = [
  {
    title: 'Operations',
    tiles: [
      { key: 'repairs', label: 'Repairs', icon: 'construct-outline', route: '/repairs?from=work', modules: ['repairs'] },
      { key: 'repair-bill', label: 'Repair Bill', icon: 'receipt-outline', route: '/repairs/bill?from=work', modules: ['repair_bill', 'repairs'] },
      { key: 'samples', label: 'Stock In/Out', icon: 'diamond-outline', route: '/samples?from=work', modules: ['samples'] },
      { key: 'cash-book', label: 'Cash Book', icon: 'wallet-outline', route: '/cashbook?from=work', modules: ['cash_book'] },
      { key: 'tasks', label: 'Tasks', icon: 'checkbox-outline', route: '/tasks?from=work', modules: ['tasks'] },
    ],
  },
  {
    title: 'Team',
    tiles: [
      { key: 'attendance', label: 'Attendance', icon: 'time-outline', route: '/(tabs)/attendance?from=work', modules: ['attendance'] },
      { key: 'payroll', label: 'Payroll', icon: 'cash-outline', route: '/(tabs)/payroll?from=work', modules: ['payroll'] },
      { key: 'ledger-entry', label: 'Ledger Entry', icon: 'document-text-outline', route: '/(tabs)/employees?from=work', modules: ['team'] },
      { key: 'approvals', label: 'Approvals', icon: 'checkmark-done-outline', route: '/approvals?from=work', modules: ['approvals'] },
    ],
  },
  {
    title: 'Reports & Ledgers',
    tiles: [
      { key: 'reports', label: 'Custom PDF Report', icon: 'document-text-outline', route: '/reports/generate', modules: ['reports'] },
      { key: 'employee-ledger', label: 'Employee Ledger', icon: 'people-outline', route: '/reports/employee-ledger', modules: ['reports'] },
      { key: 'customer-ledger', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger', modules: ['customer_ledger', 'reports'] },
      { key: 'karigar-ledger', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger', modules: ['karigar_ledger', 'reports'] },
      { key: 'loss-ledger', label: 'Loss Ledger', icon: 'trending-down-outline', route: '/reports/loss-ledger', modules: ['reports'] },
      { key: 'cash-ledger', label: 'Cash Ledger', icon: 'cash-outline', route: '/reports/cash-ledger', modules: ['reports'] },
    ],
  },
];

export default function WorkScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const showTile = (t: TileDef) => !t.modules || t.modules.length === 0 || t.modules.some((m) => hasModule(m));
  const sections = SECTIONS
    .map((s) => ({ ...s, tiles: s.tiles.filter(showTile) }))
    .filter((s) => s.tiles.length > 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="work-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Work</Text>
        <Text style={styles.subtitle}>Everything you do, in one place.</Text>

        {sections.length === 0 ? (
          <View style={styles.empty} testID="work-empty">
            <Ionicons name="briefcase-outline" size={36} color={colors.mutedText} />
            <Text style={styles.emptyText}>Nothing assigned to you yet. Ask the owner to grant you access.</Text>
          </View>
        ) : sections.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.tiles.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`work-tile-${t.key}`}
                  onPress={() => router.push(t.route as any)}
                  style={({ pressed }) => [styles.tile, pressed && { opacity: 0.8 }]}
                >
                  <View style={styles.tileIcon}>
                    <Ionicons name={t.icon} size={24} color={colors.brandPrimary} />
                  </View>
                  <Text style={styles.tileLabel}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: '600', fontFamily: fonts.display, marginBottom: 4 },
  subtitle: { color: colors.mutedText, fontSize: 12, marginBottom: spacing.xl },
  sectionLabel: {
    color: colors.brandSecondary, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
    marginBottom: spacing.md, marginTop: spacing.lg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexBasis: '31%', flexGrow: 0, maxWidth: '31%', minWidth: 96,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center',
  },
  tileIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.brand,
  },
  tileLabel: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: 'center' },
});
