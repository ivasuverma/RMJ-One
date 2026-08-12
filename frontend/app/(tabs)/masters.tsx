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
    title: 'People',
    tiles: [
      { key: 'team', label: 'Team', icon: 'people-outline', route: '/(tabs)/employees' },
      { key: 'karigars', label: 'Karigars', icon: 'hammer-outline', comingSoon: true },
      { key: 'customers', label: 'Customers', icon: 'person-add-outline', comingSoon: true },
    ],
  },
  {
    title: 'Configuration',
    tiles: [
      { key: 'shifts', label: 'Shifts', icon: 'time-outline', route: '/settings/shifts' },
      { key: 'holidays', label: 'Holidays', icon: 'calendar-outline', route: '/settings/holidays' },
    ],
  },
];

export default function MastersScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="masters-screen">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Masters</Text>
        <Text style={styles.subtitle}>The people and reference data every other module builds on.</Text>

        {SECTIONS.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionLabel}>{section.title}</Text>
            <View style={styles.grid}>
              {section.tiles.map((t) => (
                <Pressable
                  key={t.key}
                  testID={`masters-tile-${t.key}`}
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
    flexBasis: '30%', flexGrow: 1, minWidth: 96,
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
