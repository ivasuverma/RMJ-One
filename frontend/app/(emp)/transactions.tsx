import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/auth/AuthContext';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type TileDef = { key: string; label: string; icon: keyof typeof Ionicons.glyphMap; route: string; module: string };

// Every tile here maps to one of the employee-assignable modules — an owner
// grants access per module in User Roles, and this screen only shows what's
// actually been handed to this employee. If none are granted the whole
// Transactions tab is hidden by the tab layout, so this screen never renders empty.
// Only four modules are ever grantable to an employee: repairs, repair_bill,
// customer_ledger, karigar_ledger — Tasks/Approvals management is owner/admin
// only now (an employee's personal task list on the Tasks tab is unaffected;
// that's a separate, always-available feature, not this module).
const SECTIONS: { title: string; tiles: TileDef[] }[] = [
  {
    title: 'Repairs',
    tiles: [
      { key: 'repair-orders', label: 'Repair', icon: 'construct-outline', route: '/repairs', module: 'repairs' },
      { key: 'repair-bill', label: 'Repair Bill', icon: 'receipt-outline', route: '/repairs/bill', module: 'repair_bill' },
      { key: 'samples', label: 'Stock In/Out', icon: 'diamond-outline', route: '/samples', module: 'samples' },
    ],
  },
  {
    title: 'Reports',
    tiles: [
      { key: 'customer-ledger', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger', module: 'customer_ledger' },
      { key: 'karigar-ledger', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger', module: 'karigar_ledger' },
    ],
  },
];

export default function EmployeeTransactionsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const sections = SECTIONS
    .map((s) => ({ ...s, tiles: s.tiles.filter((t) => hasModule(t.module)) }))
    .filter((s) => s.tiles.length > 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="emp-transactions-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Transactions</Text>
        <Text style={styles.subtitle}>Where you record something happening.</Text>

        {sections.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyText}>Nothing assigned to you yet.</Text></View>
        ) : sections.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.tiles.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`emp-transactions-tile-${t.key}`}
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
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { color: colors.mutedText },
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
});
