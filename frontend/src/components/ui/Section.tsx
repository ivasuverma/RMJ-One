import { ReactNode, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

/** A titled group of content — icon chip + title (+ optional subtitle/right
 * slot for a "See all" link or count) followed by its children. Generalized
 * from dashboard.tsx's SectionHeader so every screen's section headers look
 * and space themselves the same way. */
export function Section({ title, icon, subtitle, right, children, testID }: {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  subtitle?: string;
  right?: ReactNode;
  children?: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {!!icon && (
            <View style={styles.iconWrap}><Ionicons name={icon} size={14} color={colors.brandSecondary} /></View>
          )}
          <Text style={styles.title}>{title}</Text>
        </View>
        {right}
      </View>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {children}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconWrap: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: colors.brandTertiary,
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: colors.onSurface, fontSize: 16, fontWeight: '600', fontFamily: fonts.display },
  subtitle: { color: colors.mutedText, fontSize: 11, marginBottom: spacing.sm, marginTop: -4 },
});
