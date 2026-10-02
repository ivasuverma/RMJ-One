import { createContext, ReactNode, useContext, useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/theme/ThemeContext';

const ACTION_W = 84;

const SwipeGuard = createContext<{ blocked: () => boolean }>({ blocked: () => false });
/** True for a moment after a swipe — a row's onPress should do nothing then. */
export function useSwipeBlocked(): () => boolean {
  return useContext(SwipeGuard).blocked;
}
const FULL_SWIPE = 170;

/**
 * iOS-style swipe-left row. A short swipe reveals the action button behind the
 * row; a long swipe runs it straight away. Horizontal drags only, so vertical
 * scrolling and taps on the row work as before.
 */
export function SwipeRow({ children, label, icon, onAction, bg, testID }: {
  children: ReactNode; label: string; icon: keyof typeof Ionicons.glyphMap;
  onAction: () => void; bg?: string; testID?: string;
}) {
  const { colors } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const open = useRef(false);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  // A drag still ends in a tap on the row underneath (on the web the row's own
  // press handling doesn't know about the swipe) — rows ask useSwipeBlocked().
  const dragged = useRef(false);
  const guard = useMemo(() => ({ blocked: () => dragged.current }), []);

  const pan = useMemo(() => {
    const settle = (to: number, done?: () => void) =>
      Animated.spring(x, { toValue: to, useNativeDriver: false, bounciness: 0, speed: 20 }).start(done ? () => done() : undefined);
    const fire = () => Animated.timing(x, { toValue: -600, duration: 180, useNativeDriver: false }).start(() => onActionRef.current());
    const horizontal = (_e: unknown, g: { dx: number; dy: number }) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
    return PanResponder.create({
      onMoveShouldSetPanResponder: horizontal,
      onMoveShouldSetPanResponderCapture: horizontal,
      onPanResponderGrant: () => { dragged.current = true; },
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_e, g) => x.setValue(Math.min(0, (open.current ? -ACTION_W : 0) + g.dx)),
      onPanResponderRelease: (_e, g) => {
        setTimeout(() => { dragged.current = false; }, 80);
        const pos = (open.current ? -ACTION_W : 0) + g.dx;
        if (pos < -FULL_SWIPE) { open.current = false; fire(); }
        else if (pos < -ACTION_W / 2) { open.current = true; settle(-ACTION_W); }
        else { open.current = false; settle(0); }
      },
      onPanResponderTerminate: () => { dragged.current = false; open.current = false; settle(0); },
    });
  }, [x]);
  const runAction = () => Animated.timing(x, { toValue: -600, duration: 180, useNativeDriver: false }).start(() => onActionRef.current());

  return (
    <SwipeGuard.Provider value={guard}>
    <View style={styles.wrap} testID={testID}>
      <View style={[StyleSheet.absoluteFill, styles.behind, { backgroundColor: colors.error }]}>
        <Pressable onPress={runAction} style={styles.action} accessibilityRole="button" accessibilityLabel={label} testID={testID ? `${testID}-action` : undefined}>
          <Ionicons name={icon} size={19} color={colors.onError} />
          <Text style={[styles.actionText, { color: colors.onError }]}>{label}</Text>
        </Pressable>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: bg ?? colors.surfaceSecondary }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
    </SwipeGuard.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  behind: { flexDirection: 'row', justifyContent: 'flex-end' },
  action: { width: ACTION_W, alignItems: 'center', justifyContent: 'center', gap: 3 },
  actionText: { fontSize: 12.5, fontWeight: '700' },
});
