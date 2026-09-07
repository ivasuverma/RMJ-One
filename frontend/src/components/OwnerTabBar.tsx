import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/auth/AuthContext';
import { ThemeColors } from '@/src/theme';
import { useTheme } from '@/src/theme/ThemeContext';
import { QuickDocCapture } from '@/src/components/QuickDocCapture';

// Owner/admin/accountant tab bar: Dashboard, Work, [capture], Ledger,
// Settings — a raised center button in place of the floating capture
// buttons that used to sit on each of those three screens separately. A
// fully custom render (rather than the default BottomTabBar) is the only
// way to slot a 5th, non-routed button in the middle of a 4-tab bar.
//
// The center button isn't a real tab (no route owns it) — it just opens the
// same QuickDocCapture sheet those floating buttons used to, now owned once
// here instead of duplicated per screen. Unlike the earlier floating-button
// saga, this sheet only ever opens from a direct tap, so the RN Modal it
// uses internally is fine as-is — the web/hydration bug that forced a raw
// DOM portal there only bit a modal meant to show automatically on load.
const VISIBLE_TABS = ['dashboard', 'work', 'ledger', 'utility'] as const;

export function OwnerTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const { hasModule } = useAuth();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [captureDoc, setCaptureDoc] = useState(false);

  const focusedOptions = descriptors[state.routes[state.index].key]?.options;
  if (focusedOptions?.tabBarStyle && (focusedOptions.tabBarStyle as any).display === 'none') {
    return null;
  }

  const barHeight = 46 + Math.max(insets.bottom, 20);
  const routes = VISIBLE_TABS
    .map((name) => state.routes.find((r) => r.name === name))
    .filter((r): r is (typeof state.routes)[number] => !!r);
  const midpoint = Math.ceil(routes.length / 2);
  const left = routes.slice(0, midpoint);
  const right = routes.slice(midpoint);
  const showCapture = hasModule('documents');

  const renderTab = (route: (typeof state.routes)[number]) => {
    const { options } = descriptors[route.key];
    const focused = state.routes[state.index].key === route.key;
    const label = (options.title ?? route.name) as string;
    const color = focused ? colors.brandPrimary : colors.mutedText;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
    };
    const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
    return (
      <Pressable
        key={route.key}
        onPress={onPress}
        onLongPress={onLongPress}
        style={styles.tabBtn}
        testID={(options as any).tabBarButtonTestID}
      >
        {options.tabBarIcon?.({ focused, color, size: 22 })}
        <Text style={[styles.tabLabel, { color }]} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { height: barHeight, paddingBottom: Math.max(insets.bottom, 20) }]}>
      {left.map(renderTab)}
      {showCapture && (
        <View style={styles.centerSlot}>
          <Pressable
            onPress={() => setCaptureDoc(true)}
            style={styles.centerBtn}
            testID="owner-tab-capture-btn"
            hitSlop={8}
          >
            <Ionicons name="camera" size={24} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      )}
      {right.map(renderTab)}
      <QuickDocCapture visible={captureDoc} onClose={() => setCaptureDoc(false)} />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface,
    borderTopWidth: 0, paddingTop: 6,
  },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 2 },
  tabLabel: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.3 },
  centerSlot: { flex: 1, alignItems: 'center' },
  centerBtn: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.brandPrimary,
    alignItems: 'center', justifyContent: 'center', marginTop: -26,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    borderWidth: 3, borderColor: colors.surface,
  },
});
