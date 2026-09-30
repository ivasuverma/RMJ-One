import { ReactNode, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { fonts, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { StickyHeader } from './StickyHeader';

/**
 * The one header every module opened from the Work tab uses, Apple style:
 * a small "‹ Work" back link, a large title (with an optional refresh button
 * beside it) and a one-line subtitle, and round action buttons on the right.
 * Pinned above the content; a hairline appears once the content scrolls under
 * it (pass `scrolled` from useScrolled()).
 */
export function ModuleHeader({
  title, subtitle, backLabel = 'Work', onBack, onRefresh, refreshing, actions, scrolled = false, testID,
}: {
  title: string;
  subtitle?: string | null;
  backLabel?: string;
  onBack?: () => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
  scrolled?: boolean;
  testID?: string;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  return (
    <StickyHeader scrolled={scrolled} testID={testID}>
      <Pressable onPress={onBack || (() => router.back())} style={s.backRow} hitSlop={8} testID="back-btn"
        accessibilityRole="button" accessibilityLabel={`Back to ${backLabel}`}>
        <Ionicons name="chevron-back" size={18} color={colors.brandPrimary} />
        <Text style={s.backText}>{backLabel}</Text>
      </Pressable>
      <View style={s.titleRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.titleInline}>
            <Text style={s.h1} numberOfLines={1}>{title}</Text>
            {onRefresh && (
              <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={10} testID="module-refresh-btn"
                accessibilityRole="button" accessibilityLabel="Refresh">
                {refreshing ? <ActivityIndicator size="small" color={colors.onSurface} /> : <Ionicons name="refresh" size={16} color={colors.onSurface} />}
              </Pressable>
            )}
          </View>
          {!!subtitle && <Text style={s.sub} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {!!actions && <View style={s.actions}>{actions}</View>}
      </View>
    </StickyHeader>
  );
}

/** A round header button: an icon, optionally filled (primary) or with a count badge. */
export function HeaderButton({ icon, onPress, primary, active, badge, testID, label }: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  primary?: boolean;
  active?: boolean;
  badge?: number;
  testID?: string;
  label?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const filled = primary || active;
  return (
    <Pressable onPress={onPress} style={[s.btn, filled && s.btnOn]} hitSlop={8} testID={testID}
      accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={filled ? colors.onBrandPrimary : colors.onSurface} />
      {!!badge && badge > 0 && <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View>}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 6, alignSelf: 'flex-start' },
  backText: { color: colors.brandPrimary, fontSize: 16, fontWeight: '500' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  titleInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h1: { color: colors.onSurface, fontSize: 26, fontWeight: '800', fontFamily: fonts.display, letterSpacing: -0.5, flexShrink: 1 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 15, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  badgeText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '800' },
});
