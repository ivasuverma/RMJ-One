import { ReactNode, useCallback, useMemo, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { spacing } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

/** The top band of a main tab (title, rate chip, bell…) pinned above the
 * scrolling content, like a native app's navigation bar. A hairline appears
 * under it once the content has scrolled beneath. */
export function StickyHeader({ children, scrolled, style, testID }: {
  children: ReactNode; scrolled: boolean; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    bar: {
      backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent', zIndex: 2,
    },
    line: { borderBottomColor: colors.divider },
  }), [colors]);
  return <View style={[s.bar, scrolled && s.line, style]} testID={testID}>{children}</View>;
}

/** Tracks whether a ScrollView has scrolled, for StickyHeader's hairline. */
export function useScrolled(): { scrolled: boolean; onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void } {
  const [scrolled, setScrolled] = useState(false);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y > 4;
    setScrolled((prev) => (prev === y ? prev : y));
  }, []);
  return { scrolled, onScroll };
}
