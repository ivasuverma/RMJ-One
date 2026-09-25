import { ReactNode, useMemo } from 'react';
import { RefreshControl, ScrollView, StyleProp, View, ViewStyle } from 'react-native';
import { Edge, SafeAreaView } from 'react-native-safe-area-context';
import { spacing, ThemeColors } from '@/src/theme';
import { StickyHeader, useScrolled } from './StickyHeader';
import { useTheme } from '@/src/theme/ThemeContext';

/** Root shell every screen in the app re-implements by hand today
 * (SafeAreaView + themed background + optional scroll/pull-to-refresh).
 * Set `scroll={false}` for screens that manage their own inner ScrollView
 * (e.g. a form inside a KeyboardAvoidingView) but still want the themed
 * SafeAreaView wrapper. */
export function Screen({
  children, header, scroll = true, refreshing, onRefresh, edges = ['top'], contentContainerStyle, testID,
}: {
  children: ReactNode;
  /** Pinned above the scroll (a main tab's top band) — see StickyHeader. */
  header?: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  contentContainerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => ({ root: { flex: 1, backgroundColor: colors.surface } }), [colors]);
  const { scrolled, onScroll } = useScrolled();

  if (!scroll) {
    return (
      <SafeAreaView style={styles.root} edges={edges} testID={testID}>
        {children}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={edges} testID={testID}>
      {header ? <StickyHeader scrolled={scrolled}>{header}</StickyHeader> : null}
      <ScrollView
        contentContainerStyle={[{ padding: spacing.lg, paddingBottom: spacing.xxl }, header ? { paddingTop: spacing.sm } : null, contentContainerStyle]}
        showsVerticalScrollIndicator={false}
        onScroll={header ? onScroll : undefined}
        scrollEventThrottle={16}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.brandPrimary} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
