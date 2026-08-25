import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, interpolate, Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useReducedMotion } from '@/src/hooks/use-reduced-motion';
import { useTheme } from '@/src/theme/ThemeContext';
import { radius, spacing, fonts, ThemeColors } from '@/src/theme';

// A bottom sheet that behaves like a real object (Apple §1–6): it springs in,
// tracks the finger 1:1, rubber-bands past the top edge, can be grabbed and
// reversed mid-flight, and flicks away with your release velocity — momentum
// projected, not snapped from the release point. Springs (not fixed-duration
// transitions) make all of that interruptible for free. Honours reduced-motion
// by swapping the spring for a short cross-fade.
//
// Drop-in for `<Modal>`-based sheets: controlled by `visible` + `onClose`.
const IN_SPRING = { damping: 34, stiffness: 420, mass: 1 };   // ~response 0.3, damping ~0.85 (Apple drawer)
const OUT_SPRING = { damping: 40, stiffness: 380, mass: 1 };

export function Sheet({ visible, onClose, title, children, testID }: {
  visible: boolean; onClose: () => void; title?: string; children: ReactNode; testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { height: screenH } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [render, setRender] = useState(visible);

  const ty = useSharedValue(screenH);        // 0 = fully open, sheetH = fully dismissed
  const sheetH = useSharedValue(screenH);    // measured content height
  const backdrop = useSharedValue(0);        // 0..1 scrim opacity
  const start = useSharedValue(0);           // ty at gesture begin (for interruptibility)

  const unmount = useCallback(() => setRender(false), []);

  useEffect(() => {
    if (visible) {
      setRender(true);
      backdrop.value = withTiming(1, { duration: 200 });
      ty.value = reduced ? 0 : withSpring(0, IN_SPRING);
    } else if (render) {
      backdrop.value = withTiming(0, { duration: 180 });
      if (reduced) runOnJS(unmount)();
      else ty.value = withSpring(sheetH.value, OUT_SPRING, (f) => { if (f) runOnJS(unmount)(); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduced]);

  const pan = Gesture.Pan()
    .onBegin(() => { start.value = ty.value; })          // grab from the live value → interruptible
    .onUpdate((e) => {
      const next = start.value + e.translationY;
      ty.value = next < 0 ? next * 0.18 : next;          // rubber-band above the open position
      backdrop.value = interpolate(ty.value, [0, sheetH.value], [1, 0], Extrapolation.CLAMP);
    })
    .onEnd((e) => {
      const projected = ty.value + e.velocityY * 0.15;   // momentum projection, not release point
      if (projected > sheetH.value * 0.35) {
        backdrop.value = withTiming(0, { duration: 160 });
        ty.value = withSpring(sheetH.value, { ...OUT_SPRING, velocity: e.velocityY }, (f) => { if (f) runOnJS(onClose)(); });
      } else {
        ty.value = withSpring(0, { ...IN_SPRING, velocity: e.velocityY });  // snap back, carry velocity
        backdrop.value = withTiming(1, { duration: 150 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!render) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} testID={testID}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined} />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[styles.sheet, sheetStyle]}
            onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) sheetH.value = h; }}
          >
            <View style={styles.grab} />
            {!!title && <Text style={styles.title}>{title}</Text>}
            {children}
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderWidth: 1, borderColor: colors.border, borderBottomWidth: 0,
    paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl,
  },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  title: { color: colors.onSurface, fontSize: 18, fontWeight: '700', fontFamily: fonts.display, marginBottom: spacing.sm },
});
