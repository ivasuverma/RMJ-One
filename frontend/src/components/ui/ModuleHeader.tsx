import { ReactNode, useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { fonts, spacing, ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { StickyHeader } from './StickyHeader';
import { GlassSurface } from './GlassSurface';

/**
 * The one header every module opened from the Work tab uses, Apple style: a
 * round back button, the title (with an optional refresh button beside it)
 * and a one-line subtitle, and round action buttons on the right, all on one
 * row. Pinned above the content; a hairline appears once the content scrolls
 * under it (pass `scrolled` from useScrolled()).
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
      <View style={s.row}>
        <HeaderButton icon="chevron-back" onPress={onBack || (() => router.back())} testID="back-btn" label={`Back to ${backLabel}`} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.titleInline}>
            <Text style={s.h1} numberOfLines={1}>{title}</Text>
            {onRefresh && (
              <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={10} testID="module-refresh-btn"
                accessibilityRole="button" accessibilityLabel="Refresh">
                {refreshing ? <ActivityIndicator size="small" color={colors.onSurface} /> : <Ionicons name="refresh" size={17} color={colors.onSurfaceSecondary} />}
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

/** A round white header button: an icon (optionally tinted), filled when
 * primary/active, or with a count badge. */
export function HeaderButton({ icon, onPress, primary, active, badge, testID, label, tint }: {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: string;
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
    <Pressable onPress={onPress} hitSlop={8} testID={testID} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [s.btnShadow, pressed && { transform: [{ scale: 0.94 }] }]}>
      {/* Glass button (Settings › Glass bar); a primary/active one stays solid gold. */}
      {filled ? (
        <View style={[s.btn, s.btnOn]}><Ionicons name={icon} size={icon === 'chevron-back' ? 24 : 21} color={colors.onBrandPrimary} /></View>
      ) : (
        <GlassSurface style={s.btn}><Ionicons name={icon} size={icon === 'chevron-back' ? 24 : 21} color={tint || colors.onSurface} /></GlassSurface>
      )}
      {!!badge && badge > 0 && <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View>}
    </Pressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  titleInline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  h1: { color: colors.onSurface, fontSize: 24, fontWeight: '800', fontFamily: fonts.display, letterSpacing: -0.5, flexShrink: 1 },
  sub: { color: colors.onSurfaceSecondary, fontSize: 13.5, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  btnShadow: {
    width: 44, height: 44, borderRadius: 22,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  btn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceSecondary,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnOn: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  badge: {
    position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.brandPrimary, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  badgeText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: '800' },
});
