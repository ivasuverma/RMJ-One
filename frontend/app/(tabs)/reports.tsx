import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { spacing, radius, fonts, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

type TileDef = {
  key: string; label: string; icon: keyof typeof Ionicons.glyphMap;
  route?: string; comingSoon?: boolean;
};

const SECTIONS: { title: string; tiles: TileDef[] }[] = [
  {
    title: 'Employee Management',
    tiles: [
      { key: 'reports', label: 'Reports', icon: 'document-text-outline', route: '/reports' },
      { key: 'employee-ledger', label: 'Employee Ledger', icon: 'people-outline', route: '/reports/employee-ledger' },
    ],
  },
  {
    title: 'Repairs',
    tiles: [
      { key: 'customer-ledger', label: 'Customer Ledger', icon: 'person-outline', route: '/reports/customer-ledger' },
      { key: 'karigar-ledger', label: 'Karigar Ledger', icon: 'hammer-outline', route: '/reports/karigar-ledger' },
    ],
  },
];

export default function ReportsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="reports-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Reports</Text>
        <Text style={styles.subtitle}>Export, review, and trace what happened.</Text>

        {SECTIONS.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.tiles.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`reports-tile-${t.key}`}
                  disabled={t.comingSoon}
                  onPress={() => t.route && router.push(t.route as any)}
                  style={({ pressed }) => [styles.tile, t.comingSoon && styles.tileDisabled, pressed && !t.comingSoon && { opacity: 0.8 }]}
                >
                  <View style={[styles.tileIcon, t.comingSoon && styles.tileIconDisabled]}>
                    <Ionicons name={t.icon} size={24} color={t.comingSoon ? colors.mutedText : colors.brandPrimary} />
                  </View>
                  <Text style={[styles.tileLabel, t.comingSoon && styles.tileLabelDisabled]}>{t.label}</Text>
                  {t.comingSoon && <Text style={styles.soon}>Soon</Text>}
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
  tileDisabled: { opacity: 0.55 },
  tileIcon: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.brand,
  },
  tileIconDisabled: { backgroundColor: colors.surfaceTertiary, borderColor: colors.border },
  tileLabel: { color: colors.onSurface, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  tileLabelDisabled: { color: colors.onSurfaceTertiary },
  soon: { color: colors.mutedText, fontSize: 10, marginTop: 2 },
});
