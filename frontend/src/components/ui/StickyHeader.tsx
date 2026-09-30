import { ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { NavigationRouteContext } from '@react-navigation/native';
import { spacing } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { useGlass } from '@/src/theme/glass';

// A page's header, frosted glass like the bottom bar: the page scrolls up
// underneath it and shows through, blurred. For that the header floats over
// the page, and the page starts its scroll content with <HeaderSpacer /> (the
// header's height, measured) — the top-edge twin of <TabBarSpacer />. A page
// without a spacer keeps the header in the normal flow above its content, so
// a page that hasn't been set up for it looks exactly as before.

// Per screen (navigation route): the header's measured height, and whether a
// spacer is mounted (which is what makes the header float).
type Entry = { height: number; spacers: number };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const entry = (key: string): Entry => {
  let e = entries.get(key);
  if (!e) { e = { height: 0, spacers: 0 }; entries.set(key, e); }
  return e;
};

function useRouteKey(): string {
  return useContext(NavigationRouteContext)?.key ?? 'root';
}

/** Put first in a page's scroll content (below a StickyHeader/ModuleHeader):
 * makes the header float over the page, and keeps the content's top clear of it. */
export function HeaderSpacer() {
  const key = useRouteKey();
  const height = useSyncExternalStore(subscribe, () => entry(key).height, () => 0);
  useLayoutEffect(() => {
    entry(key).spacers += 1; emit();
    return () => { entry(key).spacers -= 1; emit(); };
  }, [key]);
  return <View style={{ height }} pointerEvents="none" />;
}

// '#F7F5F0' → 'rgba(247,245,240,a)'
function withAlpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** The top band of a page (title, buttons…) pinned above the scrolling
 * content, like a native app's navigation bar: frosted glass once the page
 * scrolls under it (see HeaderSpacer), with a hairline under it then. */
export function StickyHeader({ children, scrolled, style, testID }: {
  children: ReactNode; scrolled: boolean; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  const { colors, scheme } = useTheme();
  const dark = scheme === 'dark';
  const { blur, tint } = useGlass();   // Settings › Glass bar — the same blur and tint as the bottom bar
  const key = useRouteKey();
  const floating = useSyncExternalStore(subscribe, () => entry(key).spacers > 0, () => false);
  const setHeight = useCallback((height: number) => {
    const h = Math.round(height);
    const en = entry(key);
    if (en.height !== h) { en.height = h; emit(); }
  }, [key]);
  const onLayout = useCallback((e: { nativeEvent: { layout: { height: number } } }) => setHeight(e.nativeEvent.layout.height), [setHeight]);

  // Glass only where content can actually pass under it; Android's blur is
  // experimental, so there (and with the blur set to 0) it stays solid.
  const glass = floating && blur > 0 && Platform.OS !== 'android';
  const s = useMemo(() => StyleSheet.create({
    bar: {
      // Tint = how much of the page colour sits on the glass (lower is clearer), as on the bar.
      backgroundColor: glass ? withAlpha(colors.surface, tint / 100) : colors.surface,
      paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent', zIndex: 2,
    },
    float: { position: 'absolute', top: 0, left: 0, right: 0 },
    anchor: { height: 0, zIndex: 10, overflow: 'visible' },
    line: { borderBottomColor: colors.divider },
  }), [colors, glass, tint]);

  // react-native-web drops backdrop-filter from styles, so set it on the element itself.
  const webRef = useRef<View>(null);
  useEffect(() => {
    const el = webRef.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el?.style) return;
    const f = glass ? `blur(${blur}px) saturate(180%)` : 'none';
    el.style.setProperty('backdrop-filter', f);
    el.style.setProperty('-webkit-backdrop-filter', f);
  });

  // Web: measure with a ResizeObserver (onLayout doesn't reliably report
  // this element once it's re-parented into the floating anchor).
  useEffect(() => {
    const el = webRef.current as unknown as HTMLElement | null;
    if (Platform.OS !== 'web' || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height));
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, [floating, setHeight]);

  const bar = (
    <View ref={webRef} onLayout={Platform.OS === 'web' ? undefined : onLayout} style={[s.bar, floating && s.float, scrolled && s.line, style]} testID={testID}>
      {glass && Platform.OS === 'ios' && (
        <BlurView pointerEvents="none" intensity={Math.min(100, blur * 2.5)} tint={dark ? 'systemUltraThinMaterialDark' : 'systemUltraThinMaterialLight'} style={StyleSheet.absoluteFill} />
      )}
      {children}
    </View>
  );
  // Floating: a zero-height anchor in the flow, so the page's scroll view
  // starts right here — under the header — instead of below it.
  return floating ? <View style={s.anchor} pointerEvents="box-none">{bar}</View> : bar;
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
