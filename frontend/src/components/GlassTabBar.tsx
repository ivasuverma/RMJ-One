import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Platform, LayoutChangeEvent } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';

// The bottom bar, iOS-26 style: a floating frosted-glass pill with the tabs,
// a gold highlight that slides to the selected tab (outline icon → filled),
// and the camera as a separate gold circle at the right end. Shared by
// OwnerTabBar and EmployeeTabBar, which only decide WHICH tabs show.
//
// The bar floats over the screen (position absolute). Each tab navigator pads
// its scenes by useTabBarSpace() — the bar's height minus TAB_OVERLAP — so a
// screen's last TAB_OVERLAP px scroll under the glass (that's what makes it
// read as frosted) while the end of a list is never hidden: every tab screen
// already ends in ≥32px of bottom padding. Things pinned to a screen's bottom
// edge (FABs, footers) add TAB_OVERLAP to their offset.

export const TAB_OVERLAP = 28;
const PILL_H = 62;

function bottomGap(insetBottom: number) {
  // Sits just above the home indicator, like the system bar; 12px on phones without one.
  return Math.max(insetBottom - 8, 12);
}

/** Bottom padding for a tab scene so its content ends above the floating bar. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return PILL_H + bottomGap(insets.bottom) - TAB_OVERLAP;
}

export type GlassTab = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;   // outline name; the filled one is used when selected
  focused: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  testID?: string;
};

function filled(icon: string): keyof typeof Ionicons.glyphMap {
  const f = icon.replace(/-outline$/, '');
  return (f in Ionicons.glyphMap ? f : icon) as keyof typeof Ionicons.glyphMap;
}

const tick = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); };

export function GlassTabBar({ tabs, onCapture, captureTestID }: {
  tabs: GlassTab[]; onCapture?: () => void; captureTestID?: string;
}) {
  const { colors, scheme } = useTheme();
  const dark = scheme === 'dark';
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors, dark), [colors, dark]);

  // Sliding highlight: measure each tab, spring the pill to the focused one.
  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const x = useRef(new Animated.Value(0)).current;
  const w = useRef(new Animated.Value(0)).current;
  const shown = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const focusedKey = tabs.find((t) => t.focused)?.key;
  const target = focusedKey ? layouts[focusedKey] : undefined;

  useEffect(() => {
    if (!target) {
      Animated.timing(shown, { toValue: 0, duration: 150, useNativeDriver: false }).start();
      return;
    }
    const spring = { useNativeDriver: false, damping: 18, stiffness: 220, mass: 0.8 };
    if (!placed.current) {           // first placement: jump, don't slide in from the left edge
      x.setValue(target.x); w.setValue(target.width); placed.current = true;
    } else {
      Animated.parallel([Animated.spring(x, { ...spring, toValue: target.x }), Animated.spring(w, { ...spring, toValue: target.width })]).start();
    }
    Animated.timing(shown, { toValue: 1, duration: 150, useNativeDriver: false }).start();
  }, [target?.x, target?.width]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTabLayout = (key: string) => (e: LayoutChangeEvent) => {
    const { x: lx, width } = e.nativeEvent.layout;
    setLayouts((l) => (l[key]?.x === lx && l[key]?.width === width ? l : { ...l, [key]: { x: lx, width } }));
  };

  // Real blur on iOS and web (backdrop-filter); Android's blur is still
  // experimental, so there the pill is a near-opaque tinted surface instead.
  const blur = Platform.OS !== 'android';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: bottomGap(insets.bottom) }]}>
      <View style={[styles.pill, styles.shadow]}>
        <View style={styles.clip}>
          {blur && (
            <BlurView intensity={dark ? 55 : 70} tint={Platform.OS === 'ios' ? (dark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight') : (dark ? 'dark' : 'light')}
              style={StyleSheet.absoluteFill} />
          )}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: blur ? styles.tint.backgroundColor : styles.solid.backgroundColor }]} />
          <Animated.View pointerEvents="none" style={[styles.highlight, { left: x, width: w, opacity: shown }]} />
          <View style={styles.row}>
            {tabs.map((t) => {
              const color = t.focused ? colors.brandPrimary : colors.onSurfaceSecondary;
              return (
                <Pressable
                  key={t.key}
                  onLayout={onTabLayout(t.key)}
                  onPress={() => { if (!t.focused) tick(); t.onPress(); }}
                  onLongPress={t.onLongPress}
                  style={styles.tab}
                  testID={t.testID}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: t.focused }}
                  accessibilityLabel={t.label}
                >
                  <Ionicons name={t.focused ? filled(t.icon) : t.icon} size={22} color={color} />
                  <Text style={[styles.label, { color }, t.focused && styles.labelOn]} numberOfLines={1}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
      {onCapture && (
        <Pressable onPress={() => { tick(); onCapture(); }} style={({ pressed }) => [styles.capture, styles.shadow, pressed && { transform: [{ scale: 0.94 }] }]}
          testID={captureTestID} hitSlop={6} accessibilityRole="button" accessibilityLabel="Capture a document">
          <Ionicons name="camera" size={25} color={colors.onBrandPrimary} />
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors, dark: boolean) => StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 10 },
  pill: { flex: 1, height: PILL_H, borderRadius: PILL_H / 2 },
  clip: {
    flex: 1, borderRadius: PILL_H / 2, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)',
  },
  shadow: {
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: dark ? 0.45 : 0.14, shadowRadius: 18, elevation: 10,
  },
  tint: { backgroundColor: dark ? 'rgba(28,28,32,0.42)' : 'rgba(255,255,255,0.5)' },
  solid: { backgroundColor: dark ? 'rgba(28,28,32,0.96)' : 'rgba(252,251,248,0.97)' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  tab: { flex: 1, height: PILL_H - 12, alignItems: 'center', justifyContent: 'center', gap: 2 },
  highlight: { position: 'absolute', top: 6, bottom: 6, borderRadius: (PILL_H - 12) / 2, backgroundColor: dark ? 'rgba(201,160,80,0.18)' : 'rgba(169,129,47,0.13)' },
  label: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.1 },
  labelOn: { fontWeight: '700' },
  capture: {
    width: PILL_H, height: PILL_H, borderRadius: PILL_H / 2, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)',
  },
});
